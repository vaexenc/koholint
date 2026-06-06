import {
	buildCliffGrid,
	buildHoleGrid,
	buildSolidGrid,
	buildTeleporterGrid,
	buildTerrainGrid,
	CharacterRenderer,
	DEBUG_OVERLAY_ALL,
	DEFAULT_DEBUG_OVERLAY,
	drawDebugOverlay,
	lerp,
	World,
	type BasicCharacter,
} from "@/game";
import {buildAnimationTable} from "@/tiled/animation";
import {browserMapLoaderEnv} from "@/tiled/browserEnv";
import {loadTiledMap, type TiledMap} from "@/tiled/loadMap";
import {renderTiledMap} from "@/tiled/renderer";
import {loadTilesets} from "@/tiled/tileset";
import {
	useEffect,
	useRef,
	useState,
	type CSSProperties,
	type PointerEvent as ReactPointerEvent,
	type WheelEvent as ReactWheelEvent,
} from "react";

const INITIAL_SCALE = 3;
const MIN_SCALE = 0.25;
const MAX_SCALE = 16;
const ZOOM_STEP = 1.15;
// per-second decay rate of the camera spring. higher = snappier.
// at 7, the camera closes ~95% of the remaining distance in ~430ms.
const CAMERA_SMOOTHING = 7;
// max dt we feed the integrator, so a tab regaining focus after a long
// pause doesn't teleport the camera in one step.
const MAX_FRAME_DT = 0.1;
// pointer travel under this many CSS pixels between down and up is treated
// as a click (teleport) rather than a drag (pan).
const CLICK_MAX_TRAVEL_PX = 4;

export type MapLoadState =
	| {status: "loading"}
	| {status: "ok"; map: TiledMap}
	| {status: "error"; message: string};

export type FollowTarget = Pick<
	BasicCharacter,
	"x" | "y" | "prevX" | "prevY" | "spriteWidth" | "spriteHeight"
>;

export type MapRendererInitContext = {
	readonly map: TiledMap;
	readonly world: World;
	readonly renderer: CharacterRenderer;
	readonly mapPixelWidth: number;
	readonly mapPixelHeight: number;
};

export type MapRendererSetup = {
	follow?: () => FollowTarget | null;
	// world-space point to center the camera on at load instead of the map's
	// geometric center (e.g. a spawn area). does not move with the simulation —
	// the follow target takes over once follow is enabled.
	initialFocus?: {x: number; y: number} | null;
	// per-frame world-space overlay, drawn into the same offscreen as the map
	// (after characters, before debug) so it shares the camera transform and
	// pixel scaling. used for the movement hint.
	drawWorldOverlay?: (ctx: CanvasRenderingContext2D, alpha: number) => void;
	dispose?: () => void;
};

export type TileClickArgs = {
	readonly worldX: number;
	readonly worldY: number;
	readonly tileX: number;
	readonly tileY: number;
	readonly map: TiledMap;
};

export type UseMapRendererParams = {
	mapUrl: string;
	follow: boolean;
	debug: boolean;
	init: (ctx: MapRendererInitContext) => Promise<MapRendererSetup> | MapRendererSetup;
	// advance simulation by dtMs; return the interpolation alpha (0..1) used
	// when drawing characters between their previous and current poses.
	step?: (dtMs: number) => number;
	onTileClick?: (args: TileClickArgs) => void;
};

type Camera = {
	scale: number;
	offsetX: number;
	offsetY: number;
	targetScale: number;
	targetOffsetX: number;
	targetOffsetY: number;
};

type Drag = {
	pointerId: number;
	button: number;
	startX: number;
	startY: number;
	startOffsetX: number;
	startOffsetY: number;
};

export type UseMapRendererResult = {
	canvasProps: {
		ref: React.RefObject<HTMLCanvasElement | null>;
		className: string;
		style: CSSProperties;
		onPointerDown: (e: ReactPointerEvent<HTMLCanvasElement>) => void;
		onPointerMove: (e: ReactPointerEvent<HTMLCanvasElement>) => void;
		onPointerUp: (e: ReactPointerEvent<HTMLCanvasElement>) => void;
		onPointerCancel: (e: ReactPointerEvent<HTMLCanvasElement>) => void;
		onWheel: (e: ReactWheelEvent<HTMLCanvasElement>) => void;
	};
	state: MapLoadState;
	zoom: number;
	cursor: {x: number; y: number} | null;
	isDragging: boolean;
};

export function useMapRenderer({
	mapUrl,
	follow,
	debug,
	init,
	step,
	onTileClick,
}: UseMapRendererParams): UseMapRendererResult {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const cameraRef = useRef<Camera>({
		scale: INITIAL_SCALE,
		offsetX: 0,
		offsetY: 0,
		targetScale: INITIAL_SCALE,
		targetOffsetX: 0,
		targetOffsetY: 0,
	});
	const dragRef = useRef<Drag | null>(null);
	const mouseRef = useRef<{x: number; y: number} | null>(null);
	const displayedZoomRef = useRef(INITIAL_SCALE);
	const displayedCursorRef = useRef<{x: number; y: number} | null>(null);

	// live config + callback refs so the load effect (deps: [mapUrl]) keeps
	// reading the latest values without re-running the whole map load.
	const followRef = useRef(follow);
	const debugRef = useRef(debug);
	const initRef = useRef(init);
	const stepRef = useRef(step);
	const onTileClickRef = useRef(onTileClick);
	useEffect(() => {
		followRef.current = follow;
	}, [follow]);
	useEffect(() => {
		debugRef.current = debug;
	}, [debug]);
	useEffect(() => {
		initRef.current = init;
	});
	useEffect(() => {
		stepRef.current = step;
	});
	useEffect(() => {
		onTileClickRef.current = onTileClick;
	});

	const setupRef = useRef<MapRendererSetup | null>(null);
	const worldRef = useRef<World | null>(null);
	const mapRef = useRef<TiledMap | null>(null);

	const [state, setState] = useState<MapLoadState>({status: "loading"});
	const [zoom, setZoom] = useState(INITIAL_SCALE);
	const [cursor, setCursor] = useState<{x: number; y: number} | null>(null);
	const [isDragging, setIsDragging] = useState(false);

	useEffect(() => {
		let cancelled = false;
		let frameHandle = 0;
		let cleanupResize: (() => void) | null = null;
		setState({status: "loading"});
		(async () => {
			try {
				const map = await loadTiledMap(mapUrl, browserMapLoaderEnv);
				const tilesets = await loadTilesets(map, mapUrl);
				if (cancelled) return;
				const canvas = canvasRef.current;
				const ctx = canvas?.getContext("2d") ?? null;
				if (!canvas || !ctx) {
					setState({status: "ok", map});
					return;
				}
				const resize = () => {
					const dpr = window.devicePixelRatio || 1;
					canvas.width = Math.floor(window.innerWidth * dpr);
					canvas.height = Math.floor(window.innerHeight * dpr);
				};
				resize();
				window.addEventListener("resize", resize);
				cleanupResize = () => window.removeEventListener("resize", resize);

				const animations = buildAnimationTable(map);
				const mapPixelWidth = map.width * map.tilewidth;
				const mapPixelHeight = map.height * map.tileheight;
				const world = new World(buildSolidGrid(map), {
					terrain: buildTerrainGrid(map),
					holes: buildHoleGrid(map),
					cliffs: buildCliffGrid(map),
					teleporters: buildTeleporterGrid(map),
				});
				const renderer = new CharacterRenderer();
				const setup = await initRef.current({
					map,
					world,
					renderer,
					mapPixelWidth,
					mapPixelHeight,
				});
				if (cancelled) {
					setup.dispose?.();
					world.dispose();
					return;
				}
				await renderer.ensureLoaded(world.characters.values());
				if (cancelled) {
					setup.dispose?.();
					world.dispose();
					return;
				}
				setupRef.current = setup;
				worldRef.current = world;
				mapRef.current = map;

				// center the viewport on first render — on the requested focus
				// point if init supplied one, otherwise on the map's geometric
				// center. set current and target to the same value so the spring
				// has nothing to animate at load.
				const focus = setup.initialFocus;
				const initialOffsetX = focus
					? window.innerWidth / 2 - focus.x * INITIAL_SCALE
					: (window.innerWidth - mapPixelWidth * INITIAL_SCALE) / 2;
				const initialOffsetY = focus
					? window.innerHeight / 2 - focus.y * INITIAL_SCALE
					: (window.innerHeight - mapPixelHeight * INITIAL_SCALE) / 2;
				cameraRef.current = {
					scale: INITIAL_SCALE,
					offsetX: initialOffsetX,
					offsetY: initialOffsetY,
					targetScale: INITIAL_SCALE,
					targetOffsetX: initialOffsetX,
					targetOffsetY: initialOffsetY,
				};

				// render the whole map at 1:1 into an offscreen canvas, then
				// upscale that single bitmap with the camera transform. drawing
				// the tiles directly through a scaled transform produces 1px
				// seams between tiles at non-integer zoom levels.
				const offscreen = document.createElement("canvas");
				offscreen.width = mapPixelWidth;
				offscreen.height = mapPixelHeight;
				const offCtx = offscreen.getContext("2d");
				if (!offCtx) throw new Error("failed to create offscreen 2d context");

				const startTime = performance.now();
				let lastFrameTime = 0;
				const renderFrame = (now: number) => {
					const dpr = window.devicePixelRatio || 1;
					const cam = cameraRef.current;
					const dt =
						lastFrameTime === 0
							? 0
							: Math.min((now - lastFrameTime) / 1000, MAX_FRAME_DT);
					lastFrameTime = now;

					// step the simulation first so the camera spring chases this
					// frame's freshly stepped follow target with zero extra latency.
					const alpha = stepRef.current?.(dt * 1000) ?? 0;
					const followTarget = followRef.current ? setup.follow?.() ?? null : null;
					if (followTarget) {
						const interpX = lerp(followTarget.prevX, followTarget.x, alpha);
						const interpY = lerp(followTarget.prevY, followTarget.y, alpha);
						const centerX = interpX + followTarget.spriteWidth / 2;
						const centerY = interpY + followTarget.spriteHeight / 2;
						cam.targetOffsetX = window.innerWidth / 2 - centerX * cam.targetScale;
						cam.targetOffsetY = window.innerHeight / 2 - centerY * cam.targetScale;
					}

					if (dt > 0) {
						const k = 1 - Math.exp(-CAMERA_SMOOTHING * dt);
						cam.scale += (cam.targetScale - cam.scale) * k;
						cam.offsetX += (cam.targetOffsetX - cam.offsetX) * k;
						cam.offsetY += (cam.targetOffsetY - cam.offsetY) * k;
						// snap once we're within sub-pixel / sub-percent distance so
						// the spring doesn't tail off into floating-point noise.
						if (Math.abs(cam.targetScale - cam.scale) < cam.targetScale * 0.0005)
							cam.scale = cam.targetScale;
						if (Math.abs(cam.targetOffsetX - cam.offsetX) < 0.25)
							cam.offsetX = cam.targetOffsetX;
						if (Math.abs(cam.targetOffsetY - cam.offsetY) < 0.25)
							cam.offsetY = cam.targetOffsetY;
					}

					offCtx.setTransform(1, 0, 0, 1, 0, 0);
					offCtx.clearRect(0, 0, mapPixelWidth, mapPixelHeight);
					const elapsedMs = now - startTime;
					const overlay = debugRef.current ? DEBUG_OVERLAY_ALL : DEFAULT_DEBUG_OVERLAY;
					renderTiledMap(offCtx, {
						map,
						tilesets,
						animations,
						timeMs: elapsedMs,
						debugObjects: overlay.objects,
					});
					renderer.drawAll(offCtx, world, true, alpha);
					setup.drawWorldOverlay?.(offCtx, alpha);
					drawDebugOverlay(offCtx, world, overlay);
					ctx.setTransform(1, 0, 0, 1, 0, 0);
					ctx.imageSmoothingEnabled = false;
					ctx.clearRect(0, 0, canvas.width, canvas.height);
					ctx.setTransform(
						cam.scale * dpr,
						0,
						0,
						cam.scale * dpr,
						cam.offsetX * dpr,
						cam.offsetY * dpr
					);
					ctx.drawImage(offscreen, 0, 0);

					// push the live camera into the overlay state, but only when
					// the user-visible (rounded) value actually changes, to avoid
					// re-rendering the overlay every single frame.
					if (Math.abs(cam.scale - displayedZoomRef.current) >= 0.005) {
						displayedZoomRef.current = cam.scale;
						setZoom(cam.scale);
					}
					const mouse = mouseRef.current;
					if (mouse) {
						const wx = (mouse.x - cam.offsetX) / cam.scale;
						const wy = (mouse.y - cam.offsetY) / cam.scale;
						const prev = displayedCursorRef.current;
						if (
							!prev ||
							Math.floor(prev.x) !== Math.floor(wx) ||
							Math.floor(prev.y) !== Math.floor(wy)
						) {
							displayedCursorRef.current = {x: wx, y: wy};
							setCursor({x: wx, y: wy});
						}
					}

					frameHandle = requestAnimationFrame(renderFrame);
				};
				frameHandle = requestAnimationFrame(renderFrame);
				setState({status: "ok", map});
			} catch (err) {
				if (!cancelled)
					setState({
						status: "error",
						message: err instanceof Error ? err.message : String(err),
					});
			}
		})();
		return () => {
			cancelled = true;
			if (frameHandle !== 0) cancelAnimationFrame(frameHandle);
			cleanupResize?.();
			setupRef.current?.dispose?.();
			worldRef.current?.dispose();
			setupRef.current = null;
			worldRef.current = null;
			mapRef.current = null;
		};
	}, [mapUrl]);

	const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
		const cam = cameraRef.current;
		// commit any in-flight spring animation to the current pose, so the
		// drag starts from where the user actually sees the map right now.
		cam.targetScale = cam.scale;
		cam.targetOffsetX = cam.offsetX;
		cam.targetOffsetY = cam.offsetY;
		dragRef.current = {
			pointerId: e.pointerId,
			button: e.button,
			startX: e.clientX,
			startY: e.clientY,
			startOffsetX: cam.offsetX,
			startOffsetY: cam.offsetY,
		};
		e.currentTarget.setPointerCapture(e.pointerId);
		setIsDragging(true);
	};

	const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
		mouseRef.current = {x: e.clientX, y: e.clientY};
		const drag = dragRef.current;
		if (drag && drag.pointerId === e.pointerId) {
			const nextX = drag.startOffsetX + (e.clientX - drag.startX);
			const nextY = drag.startOffsetY + (e.clientY - drag.startY);
			const cam = cameraRef.current;
			// drag is direct manipulation: write current and target together
			// so the map tracks the cursor 1:1 with no smoothing lag.
			cam.offsetX = nextX;
			cam.offsetY = nextY;
			cam.targetOffsetX = nextX;
			cam.targetOffsetY = nextY;
		}
	};

	const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
		const drag = dragRef.current;
		if (drag?.pointerId !== e.pointerId) return;
		const travel = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
		const wasLeft = drag.button === 0;
		dragRef.current = null;
		e.currentTarget.releasePointerCapture(e.pointerId);
		setIsDragging(false);
		if (!wasLeft || travel > CLICK_MAX_TRAVEL_PX) return;
		const map = mapRef.current;
		if (!map) return;
		const cam = cameraRef.current;
		const worldX = (e.clientX - cam.offsetX) / cam.scale;
		const worldY = (e.clientY - cam.offsetY) / cam.scale;
		const tileX = Math.floor(worldX / map.tilewidth);
		const tileY = Math.floor(worldY / map.tileheight);
		if (tileX < 0 || tileY < 0 || tileX >= map.width || tileY >= map.height) return;
		onTileClickRef.current?.({worldX, worldY, tileX, tileY, map});
	};

	const onWheel = (e: ReactWheelEvent<HTMLCanvasElement>) => {
		mouseRef.current = {x: e.clientX, y: e.clientY};
		const cam = cameraRef.current;
		const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
		const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, cam.targetScale * factor));
		if (newScale === cam.targetScale) return;
		// pivot against the target (intended) camera, not the live one. this
		// keeps the focal point stable across rapid successive wheel events
		// while the spring is still mid-flight from the previous tick.
		const worldX = (e.clientX - cam.targetOffsetX) / cam.targetScale;
		const worldY = (e.clientY - cam.targetOffsetY) / cam.targetScale;
		cam.targetScale = newScale;
		cam.targetOffsetX = e.clientX - worldX * newScale;
		cam.targetOffsetY = e.clientY - worldY * newScale;
	};

	return {
		canvasProps: {
			ref: canvasRef,
			className: "absolute inset-0 h-full w-full touch-none select-none",
			style: {
				imageRendering: "pixelated",
				cursor: isDragging ? "grabbing" : "grab",
			},
			onPointerDown,
			onPointerMove,
			onPointerUp,
			onPointerCancel: onPointerUp,
			onWheel,
		},
		state,
		zoom,
		cursor,
		isDragging,
	};
}
