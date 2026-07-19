import {
	buildCliffGrid,
	buildHoleGrid,
	buildPushGrid,
	buildSolidGrid,
	buildTeleporterGrid,
	buildTerrainGrid,
	CharacterRenderer,
	collisionCenter,
	createDebugOverlay,
	DEBUG_OVERLAY_ALL,
	DEFAULT_DEBUG_OVERLAY,
	lerp,
	World,
	type BasicCharacter,
} from "@/game";
import {buildAnimationTable} from "@/tiled/animation";
import {browserMapLoaderEnv} from "@/tiled/browserEnv";
import {loadTiledMap, type TiledMap} from "@/tiled/loadMap";
import {buildMapRenderCache, drawMapCache, type MapRenderCache} from "@/tiled/renderer";
import {loadTilesets, type LoadedTileset} from "@/tiled/tileset";
import {
	useEffect,
	useRef,
	useState,
	type CSSProperties,
	type MouseEvent as ReactMouseEvent,
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
// a steer release this quick (and within CLICK_MAX_TRAVEL_PX) still counts as
// a tap/click. steering engages instantly on press for zero input lag, so a
// tap steers for a few ticks first — harmless, since where a click means
// teleport the teleport overrides the position anyway.
const TAP_MAX_MS = 200;

// maps and their tilesets are immutable per URL, so keep them for the app's
// lifetime: switching between the online and offline pages (which share a map)
// then remounts without refetching — and without a loading screen. a failed
// load is evicted so a retry refetches.
const mapAssetCache = new Map<string, Promise<{map: TiledMap; tilesets: LoadedTileset[]}>>();

function loadMapAssets(mapUrl: string) {
	const cached = mapAssetCache.get(mapUrl);
	if (cached) return cached;
	const promise = (async () => {
		const map = await loadTiledMap(mapUrl, browserMapLoaderEnv);
		const tilesets = await loadTilesets(map, mapUrl);
		return {map, tilesets};
	})();
	promise.catch(() => mapAssetCache.delete(mapUrl));
	mapAssetCache.set(mapUrl, promise);
	return promise;
}

// nearest world-space point (one axis) the camera can actually pin to the
// screen anchor: derive the offset that would put `center` at `anchor`, run
// it through the offset clamp, and convert back to world space. anchor and
// viewport strip are decoupled because overlay UI (the chat) shrinks the
// coverage strip without moving the point the followed character should sit at.
function clampFollowCenter(
	center: number,
	scale: number,
	mapPixels: number,
	viewportStart: number,
	viewportEnd: number,
	anchor: number
): number {
	const offset = clampCameraOffset(
		anchor - center * scale,
		scale,
		mapPixels,
		viewportStart,
		viewportEnd
	);
	return (anchor - offset) / scale;
}

// constrain a camera offset (one axis) so the scaled map always covers the
// screen strip [viewportStart, viewportEnd], hiding any out-of-map area there.
// when the map is smaller than the strip on this axis it can't cover it, so
// center it in the strip instead.
function clampCameraOffset(
	offset: number,
	scale: number,
	mapPixels: number,
	viewportStart: number,
	viewportEnd: number
): number {
	const scaled = mapPixels * scale;
	const viewport = viewportEnd - viewportStart;
	if (scaled <= viewport) return viewportStart + (viewport - scaled) / 2;
	// offset viewportStart aligns the map's near edge to the strip's; the
	// smallest offset aligns the far edges. anything outside exposes the void.
	return Math.min(viewportStart, Math.max(viewportEnd - scaled, offset));
}

export type MapLoadState =
	| {status: "loading"}
	| {status: "ok"; map: TiledMap}
	| {status: "error"; message: string};

export type FollowTarget = Pick<
	BasicCharacter,
	"x" | "y" | "prevX" | "prevY" | "spriteWidth" | "spriteHeight" | "collisionBox"
>;

export type MapRendererInitContext = {
	readonly map: TiledMap;
	readonly world: World;
	readonly renderer: CharacterRenderer;
	readonly mapPixelWidth: number;
	readonly mapPixelHeight: number;
	// projects a client-space (CSS px) point into world coordinates under the
	// live camera. safe to call every tick — it reads the camera at call time.
	readonly screenToWorld: (x: number, y: number) => readonly [number, number];
};

export type MapRendererSetup = {
	follow?: () => FollowTarget | null;
	// world-space point to center the camera on at load instead of the map's
	// geometric center (e.g. a spawn area). does not move with the simulation —
	// the follow target takes over once follow is enabled.
	initialFocus?: {x: number; y: number} | null;
	// per-frame screen-space overlay, drawn on the main canvas (CSS pixels)
	// after the offscreen blit so it stays crisp regardless of camera zoom.
	// `worldToScreen` projects a world-space anchor into the same CSS-pixel
	// space the overlay draws in. `zoom` is the live camera scale, for overlays
	// that size themselves relative to it. used for the movement hint.
	drawScreenOverlay?: (
		ctx: CanvasRenderingContext2D,
		alpha: number,
		worldToScreen: (x: number, y: number) => readonly [number, number],
		zoom: number
	) => void;
	// receives the pointer position (client CSS px) of a hold-to-walk gesture —
	// re-fed on every move, null when the gesture ends. providing this reroutes
	// single-finger touch (always) and the left mouse/pen button (when
	// clickToMove is set) from camera panning to character steering; two-finger
	// pan/zoom, other-button drags, and tap/click-to-teleport keep working.
	onSteer?: (point: {x: number; y: number} | null) => void;
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
	// CSS pixels along each window side edge covered by overlay UI (the chat
	// panel). edge clamping treats only the remaining strip as the viewport, so
	// the map can pan out from under the overlay at that edge; centering still
	// anchors to the full window.
	insetLeft?: number;
	insetRight?: number;
	// routes the left mouse/pen button to hold-to-walk steering (like touch)
	// instead of camera panning. only meaningful when init supplies onSteer.
	clickToMove?: boolean;
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

// two-finger pinch session: the scale/distance baseline it started from and
// the world point under the fingers' midpoint, kept pinned there while the
// gesture zooms and pans.
type Pinch = {
	startDist: number;
	startScale: number;
	worldX: number;
	worldY: number;
};

// hold-to-walk session (single touch, or left mouse/pen with click-to-move).
// steers from the moment of the press; the start pose/time only serve to
// reclassify a quick, still release as a tap (click) on the way out.
type Steer = {
	pointerId: number;
	startX: number;
	startY: number;
	startTime: number;
};

function clampScale(scale: number): number {
	return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export type UseMapRendererResult = {
	canvasProps: {
		ref: React.RefObject<HTMLCanvasElement | null>;
		className: string;
		style: CSSProperties;
		onPointerDown: (e: ReactPointerEvent<HTMLCanvasElement>) => void;
		onPointerMove: (e: ReactPointerEvent<HTMLCanvasElement>) => void;
		onPointerUp: (e: ReactPointerEvent<HTMLCanvasElement>) => void;
		onPointerCancel: (e: ReactPointerEvent<HTMLCanvasElement>) => void;
		onContextMenu: (e: ReactMouseEvent<HTMLCanvasElement>) => void;
		onWheel: (e: ReactWheelEvent<HTMLCanvasElement>) => void;
	};
	state: MapLoadState;
	zoom: number;
	playerTile: {x: number; y: number} | null;
	isDragging: boolean;
};

export function useMapRenderer({
	mapUrl,
	follow,
	debug,
	insetLeft = 0,
	insetRight = 0,
	clickToMove = false,
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
	// every pointer currently down on the canvas, in press order (Map preserves
	// insertion, so the first two entries are the pinch pair).
	const pointersRef = useRef(new Map<number, {x: number; y: number}>());
	const pinchRef = useRef<Pinch | null>(null);
	const steerRef = useRef<Steer | null>(null);
	// true from the moment a gesture gains a second finger until every finger
	// lifts, so no phase of a pinch can end in a tile click.
	const multiTouchRef = useRef(false);
	// the world point under the cursor that an in-flight wheel zoom keeps pinned
	// in place, plus the screen point it's pinned to. null when not zooming.
	const zoomAnchorRef = useRef<{
		worldX: number;
		worldY: number;
		screenX: number;
		screenY: number;
	} | null>(null);
	// world-space point the follow camera eases toward, so a zoom stays centered
	// on the player at every scale. null when not following.
	const followFocusRef = useRef<{x: number; y: number} | null>(null);
	const mapSizeRef = useRef<{width: number; height: number} | null>(null);
	const displayedZoomRef = useRef(INITIAL_SCALE);
	const displayedPlayerTileRef = useRef<{x: number; y: number} | null>(null);
	const displayedCanDragRef = useRef(false);

	// live config + callback refs so the load effect (deps: [mapUrl]) keeps
	// reading the latest values without re-running the whole map load.
	const followRef = useRef(follow);
	const debugRef = useRef(debug);
	const clickToMoveRef = useRef(clickToMove);
	const insetsRef = useRef({left: insetLeft, right: insetRight});
	// the insets the camera math actually uses; spring toward insetsRef in the
	// render loop so showing/hiding/resizing/side-switching the overlay glides
	// the camera instead of snapping it.
	const easedInsetsRef = useRef({left: insetLeft, right: insetRight});
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
		clickToMoveRef.current = clickToMove;
	}, [clickToMove]);
	useEffect(() => {
		insetsRef.current = {left: insetLeft, right: insetRight};
	}, [insetLeft, insetRight]);
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
	const [playerTile, setPlayerTile] = useState<{x: number; y: number} | null>(null);
	const [isDragging, setIsDragging] = useState(false);
	// whether a drag could actually pan the map right now — false while the
	// camera is locked to the player (follow) or the map is fully clamped.
	const [canDrag, setCanDrag] = useState(false);

	// x-axis strip of the window not covered by the side overlays — the region
	// the camera clamps the map to cover. end is kept >= start for degenerate
	// windows narrower than the overlays.
	const viewportXStrip = () => {
		const {left, right} = easedInsetsRef.current;
		return {start: left, end: Math.max(left, window.innerWidth - right)};
	};

	useEffect(() => {
		let cancelled = false;
		let frameHandle = 0;
		let cleanupResize: (() => void) | null = null;
		setState({status: "loading"});
		(async () => {
			try {
				const {map, tilesets} = await loadMapAssets(mapUrl);
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
					push: buildPushGrid(map),
				});
				const renderer = new CharacterRenderer();
				const setup = await initRef.current({
					map,
					world,
					renderer,
					mapPixelWidth,
					mapPixelHeight,
					screenToWorld: (x, y) => {
						const cam = cameraRef.current;
						return [(x - cam.offsetX) / cam.scale, (y - cam.offsetY) / cam.scale];
					},
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
				mapSizeRef.current = {width: mapPixelWidth, height: mapPixelHeight};

				// center the viewport on first render — on the requested focus
				// point if init supplied one, otherwise on the map's geometric
				// center. set current and target to the same value so the spring
				// has nothing to animate at load.
				easedInsetsRef.current = {...insetsRef.current};
				const initialVpX = viewportXStrip();
				const focus = setup.initialFocus;
				const initialOffsetX = clampCameraOffset(
					focus
						? window.innerWidth / 2 - focus.x * INITIAL_SCALE
						: (window.innerWidth - mapPixelWidth * INITIAL_SCALE) / 2,
					INITIAL_SCALE,
					mapPixelWidth,
					initialVpX.start,
					initialVpX.end
				);
				const initialOffsetY = clampCameraOffset(
					focus
						? window.innerHeight / 2 - focus.y * INITIAL_SCALE
						: (window.innerHeight - mapPixelHeight * INITIAL_SCALE) / 2,
					INITIAL_SCALE,
					mapPixelHeight,
					0,
					window.innerHeight
				);
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

				// the static map is rasterized once and reused every frame; only
				// animated cells and characters are redrawn. rebuilt only when the
				// object-debug overlay toggles, since that bakes outlines into the
				// static layers.
				const buildCache = (debugObjects: boolean): MapRenderCache =>
					buildMapRenderCache(
						{map, tilesets, animations, timeMs: 0, debugObjects},
						mapPixelWidth,
						mapPixelHeight
					);
				let cacheDebugObjects = (
					debugRef.current ? DEBUG_OVERLAY_ALL : DEFAULT_DEBUG_OVERLAY
				).objects;
				let mapCache = buildCache(cacheDebugObjects);

				const debugOverlay = createDebugOverlay(mapPixelWidth, mapPixelHeight);

				const startTime = performance.now();
				let lastFrameTime = 0;
				let hadPlayerTarget = false;
				const renderFrame = (now: number) => {
					const dpr = window.devicePixelRatio || 1;
					const cam = cameraRef.current;
					const dt =
						lastFrameTime === 0
							? 0
							: Math.min((now - lastFrameTime) / 1000, MAX_FRAME_DT);
					lastFrameTime = now;
					const k = dt > 0 ? 1 - Math.exp(-CAMERA_SMOOTHING * dt) : 0;

					// ease the overlay insets with the same spring as the camera so a
					// chat show/hide/resize/side-switch moves the clamp limits — and
					// with them the camera — smoothly instead of snapping.
					const eased = easedInsetsRef.current;
					const insets = insetsRef.current;
					eased.left += (insets.left - eased.left) * k;
					eased.right += (insets.right - eased.right) * k;
					if (Math.abs(insets.left - eased.left) < 0.25) eased.left = insets.left;
					if (Math.abs(insets.right - eased.right) < 0.25) eased.right = insets.right;
					const vpX = viewportXStrip();

					// step the simulation first so the camera spring chases this
					// frame's freshly stepped follow target with zero extra latency.
					const alpha = stepRef.current?.(dt * 1000) ?? 0;
					// the local player, resolved every frame whether follow is on or
					// not: the camera only consumes it while following, but the HUD
					// player-tile readout always does.
					const playerTarget = setup.follow?.() ?? null;
					const followTarget = followRef.current ? playerTarget : null;
					// when the follow target appears (the welcome placing the self
					// character) and init gave no viewpoint of its own, snap the
					// camera onto it (following or not) — easing would sweep it
					// across the map from a meaningless start. with an initialFocus
					// (mode-switch continuity) the spring instead pans from there.
					if (playerTarget && !hadPlayerTarget && !setup.initialFocus) {
						const centerX = playerTarget.x + playerTarget.spriteWidth / 2;
						const centerY = playerTarget.y + playerTarget.spriteHeight / 2;
						cam.offsetX = clampCameraOffset(
							window.innerWidth / 2 - centerX * cam.scale,
							cam.scale,
							mapPixelWidth,
							vpX.start,
							vpX.end
						);
						cam.offsetY = clampCameraOffset(
							window.innerHeight / 2 - centerY * cam.scale,
							cam.scale,
							mapPixelHeight,
							0,
							window.innerHeight
						);
						cam.targetOffsetX = clampCameraOffset(
							window.innerWidth / 2 - centerX * cam.targetScale,
							cam.targetScale,
							mapPixelWidth,
							vpX.start,
							vpX.end
						);
						cam.targetOffsetY = clampCameraOffset(
							window.innerHeight / 2 - centerY * cam.targetScale,
							cam.targetScale,
							mapPixelHeight,
							0,
							window.innerHeight
						);
						followFocusRef.current = null;
					}
					hadPlayerTarget = playerTarget !== null;
					// the world-space point the follow camera wants centered this
					// frame; the offset is derived from it below once the live scale
					// is known. null when not following.
					let followCenter: {x: number; y: number} | null = null;
					if (followTarget) {
						const interpX = lerp(followTarget.prevX, followTarget.x, alpha);
						const interpY = lerp(followTarget.prevY, followTarget.y, alpha);
						followCenter = {
							x: interpX + followTarget.spriteWidth / 2,
							y: interpY + followTarget.spriteHeight / 2,
						};
					}

					// keep the target inside the map bounds (the viewport may have
					// resized, or follow/zoom may have pushed it past an edge).
					cam.targetOffsetX = clampCameraOffset(
						cam.targetOffsetX,
						cam.targetScale,
						mapPixelWidth,
						vpX.start,
						vpX.end
					);
					cam.targetOffsetY = clampCameraOffset(
						cam.targetOffsetY,
						cam.targetScale,
						mapPixelHeight,
						0,
						window.innerHeight
					);

					if (dt > 0) {
						cam.scale += (cam.targetScale - cam.scale) * k;
						// snap once we're within sub-pixel / sub-percent distance so
						// the spring doesn't tail off into floating-point noise.
						if (Math.abs(cam.targetScale - cam.scale) < cam.targetScale * 0.0005)
							cam.scale = cam.targetScale;

						if (followCenter) {
							// a zoom while following stays centered on the player, so a
							// pending cursor anchor is moot.
							zoomAnchorRef.current = null;
							// ease the camera's focus toward the player in WORLD space,
							// then derive the offset from the live scale so the player
							// stays centered at every in-between scale. easing the screen
							// offset toward a target built from targetScale instead leaves
							// the player off-center mid-zoom and slides it back when the
							// spring settles — the post-zoom shift.
							const focus = followFocusRef.current ?? {
								x: (window.innerWidth / 2 - cam.offsetX) / cam.scale,
								y: (window.innerHeight / 2 - cam.offsetY) / cam.scale,
							};
							// ease toward the nearest center the edge clamp can honor —
							// aiming at the raw player center makes the offset slam into
							// the clamp mid-flight near a map edge instead of decelerating.
							focus.x +=
								(clampFollowCenter(
									followCenter.x,
									cam.scale,
									mapPixelWidth,
									vpX.start,
									vpX.end,
									window.innerWidth / 2
								) -
									focus.x) *
								k;
							focus.y +=
								(clampFollowCenter(
									followCenter.y,
									cam.scale,
									mapPixelHeight,
									0,
									window.innerHeight,
									window.innerHeight / 2
								) -
									focus.y) *
								k;
							followFocusRef.current = focus;
							cam.offsetX = window.innerWidth / 2 - focus.x * cam.scale;
							cam.offsetY = window.innerHeight / 2 - focus.y * cam.scale;
							cam.targetOffsetX = window.innerWidth / 2 - focus.x * cam.targetScale;
							cam.targetOffsetY = window.innerHeight / 2 - focus.y * cam.targetScale;
						} else {
							// not following: forget the focus so re-enabling follow eases
							// from wherever the camera currently looks rather than a stale
							// point.
							followFocusRef.current = null;
							const anchor = zoomAnchorRef.current;
							if (anchor) {
								// derive the offset from the live (springing) scale so the
								// anchored world point stays pinned under the cursor at every
								// in-between scale. springing the offset independently instead
								// lets the focal point drift mid-zoom and snap back when the
								// spring settles — the post-zoom shift.
								cam.offsetX = anchor.screenX - anchor.worldX * cam.scale;
								cam.offsetY = anchor.screenY - anchor.worldY * cam.scale;
								cam.targetOffsetX =
									anchor.screenX - anchor.worldX * cam.targetScale;
								cam.targetOffsetY =
									anchor.screenY - anchor.worldY * cam.targetScale;
								if (cam.scale === cam.targetScale) zoomAnchorRef.current = null;
							} else {
								cam.offsetX += (cam.targetOffsetX - cam.offsetX) * k;
								cam.offsetY += (cam.targetOffsetY - cam.offsetY) * k;
								if (Math.abs(cam.targetOffsetX - cam.offsetX) < 0.25)
									cam.offsetX = cam.targetOffsetX;
								if (Math.abs(cam.targetOffsetY - cam.offsetY) < 0.25)
									cam.offsetY = cam.targetOffsetY;
							}
						}
					}

					// the spring tracks a clamped target, but its in-flight scale can
					// momentarily expose the void; clamp the live offset against the
					// live scale so an out-of-map area is never actually drawn.
					cam.offsetX = clampCameraOffset(
						cam.offsetX,
						cam.scale,
						mapPixelWidth,
						vpX.start,
						vpX.end
					);
					cam.offsetY = clampCameraOffset(
						cam.offsetY,
						cam.scale,
						mapPixelHeight,
						0,
						window.innerHeight
					);

					offCtx.setTransform(1, 0, 0, 1, 0, 0);
					const elapsedMs = now - startTime;
					const overlay = debugRef.current ? DEBUG_OVERLAY_ALL : DEFAULT_DEBUG_OVERLAY;
					if (overlay.objects !== cacheDebugObjects) {
						cacheDebugObjects = overlay.objects;
						mapCache = buildCache(cacheDebugObjects);
					}
					drawMapCache(
						offCtx,
						mapCache,
						tilesets,
						animations,
						elapsedMs,
						mapPixelWidth,
						mapPixelHeight
					);
					renderer.drawAll(offCtx, world, true, alpha);
					debugOverlay.draw(offCtx, world, overlay);
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
					if (setup.drawScreenOverlay) {
						// switch to CSS-pixel space (DPR only) so overlays render
						// crisp without the camera's nearest-neighbor upscale.
						ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
						ctx.imageSmoothingEnabled = true;
						setup.drawScreenOverlay(
							ctx,
							alpha,
							(x, y) => [x * cam.scale + cam.offsetX, y * cam.scale + cam.offsetY],
							cam.scale
						);
					}

					// keep the grab affordance honest: no grab cursor while the left
					// button steers instead of pans (click-to-move), while the camera
					// is locked to the player (the follow spring overrides any drag),
					// or while the clamp leaves no room to pan on either axis
					// (matches clampCameraOffset's centering case).
					const leftButtonSteers = clickToMoveRef.current && setup.onSteer !== undefined;
					const dragPossible =
						!leftButtonSteers &&
						!followTarget &&
						(mapPixelWidth * cam.scale > vpX.end - vpX.start ||
							mapPixelHeight * cam.scale > window.innerHeight);
					if (dragPossible !== displayedCanDragRef.current) {
						displayedCanDragRef.current = dragPossible;
						setCanDrag(dragPossible);
					}

					// push the live camera into the overlay state, but only when
					// the user-visible (rounded) value actually changes, to avoid
					// re-rendering the overlay every single frame.
					if (Math.abs(cam.scale - displayedZoomRef.current) >= 0.005) {
						displayedZoomRef.current = cam.scale;
						setZoom(cam.scale);
					}
					// surface the player's occupied tile (collision-box center) into
					// overlay state, but only when the rounded tile changes so the HUD
					// doesn't re-render every frame. inverts the teleport placement in
					// onTileClick, so click-to-teleport round-trips to the shown tile.
					if (playerTarget) {
						const center = collisionCenter(playerTarget);
						const tileX = Math.floor(center.x / map.tilewidth);
						const tileY = Math.floor(center.y / map.tileheight);
						const prev = displayedPlayerTileRef.current;
						if (!prev || prev.x !== tileX || prev.y !== tileY) {
							displayedPlayerTileRef.current = {x: tileX, y: tileY};
							setPlayerTile({x: tileX, y: tileY});
						}
					} else if (displayedPlayerTileRef.current) {
						displayedPlayerTileRef.current = null;
						setPlayerTile(null);
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
			steerRef.current = null;
			setupRef.current?.dispose?.();
			worldRef.current?.dispose();
			setupRef.current = null;
			worldRef.current = null;
			mapRef.current = null;
			mapSizeRef.current = null;
		};
	}, [mapUrl]);

	// baseline for a (re)starting pinch: the current distance between the two
	// tracked fingers and the world point under their midpoint. re-derived
	// whenever the finger set changes so the map never jumps mid-gesture.
	const capturePinch = (): Pinch | null => {
		const [a, b] = [...pointersRef.current.values()];
		if (!a || !b) return null;
		const cam = cameraRef.current;
		return {
			startDist: Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1),
			startScale: cam.scale,
			worldX: ((a.x + b.x) / 2 - cam.offsetX) / cam.scale,
			worldY: ((a.y + b.y) / 2 - cam.offsetY) / cam.scale,
		};
	};

	const endSteer = () => {
		if (!steerRef.current) return;
		setupRef.current?.onSteer?.(null);
		steerRef.current = null;
	};

	const fireTileClick = (clientX: number, clientY: number) => {
		const map = mapRef.current;
		if (!map) return;
		const cam = cameraRef.current;
		const worldX = (clientX - cam.offsetX) / cam.scale;
		const worldY = (clientY - cam.offsetY) / cam.scale;
		const tileX = Math.floor(worldX / map.tilewidth);
		const tileY = Math.floor(worldY / map.tileheight);
		if (tileX < 0 || tileY < 0 || tileX >= map.width || tileY >= map.height) return;
		onTileClickRef.current?.({worldX, worldY, tileX, tileY, map});
	};

	const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
		const cam = cameraRef.current;
		// commit any in-flight spring animation to the current pose, so the
		// gesture starts from where the user actually sees the map right now.
		cam.targetScale = cam.scale;
		cam.targetOffsetX = cam.offsetX;
		cam.targetOffsetY = cam.offsetY;
		// end any in-flight zoom so its offset lock doesn't fight the gesture.
		zoomAnchorRef.current = null;
		e.currentTarget.setPointerCapture(e.pointerId);
		const pointers = pointersRef.current;
		pointers.set(e.pointerId, {x: e.clientX, y: e.clientY});
		if (pointers.size === 2) {
			// a second finger turns the gesture into a pinch (zoom + pan around
			// the midpoint) for the rest of it, ending any drag or steer.
			multiTouchRef.current = true;
			endSteer();
			dragRef.current = null;
			setIsDragging(false);
			pinchRef.current = capturePinch();
			return;
		}
		if (pointers.size > 2) return;
		// hold-to-walk (when the page wired it up): a single touch always steers
		// the character — camera panning stays on two fingers there — and the
		// left mouse/pen button steers when click-to-move is on, leaving panning
		// to the other buttons. steering starts on the press itself.
		const steersPointer =
			e.pointerType === "touch" || (clickToMoveRef.current && e.button === 0);
		const onSteer = setupRef.current?.onSteer;
		if (steersPointer && onSteer) {
			endSteer();
			steerRef.current = {
				pointerId: e.pointerId,
				startX: e.clientX,
				startY: e.clientY,
				startTime: performance.now(),
			};
			onSteer({x: e.clientX, y: e.clientY});
			return;
		}
		dragRef.current = {
			pointerId: e.pointerId,
			button: e.button,
			startX: e.clientX,
			startY: e.clientY,
			startOffsetX: cam.offsetX,
			startOffsetY: cam.offsetY,
		};
		setIsDragging(true);
	};

	const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
		const tracked = pointersRef.current.get(e.pointerId);
		if (tracked) {
			tracked.x = e.clientX;
			tracked.y = e.clientY;
		}
		const steer = steerRef.current;
		if (steer && steer.pointerId === e.pointerId) {
			setupRef.current?.onSteer?.({x: e.clientX, y: e.clientY});
			return;
		}
		const pinch = pinchRef.current;
		if (pinch) {
			const [a, b] = [...pointersRef.current.values()];
			if (!a || !b) return;
			const cam = cameraRef.current;
			const dist = Math.hypot(a.x - b.x, a.y - b.y);
			const scale = clampScale((pinch.startScale * dist) / pinch.startDist);
			// direct manipulation like the drag: write current and target
			// together so the map tracks the fingers 1:1 with no smoothing lag.
			cam.scale = scale;
			cam.targetScale = scale;
			// following keeps the camera centered on the player, so the pinch
			// only zooms; the follow logic places the offset.
			if (followRef.current) return;
			const size = mapSizeRef.current;
			let nextX = (a.x + b.x) / 2 - pinch.worldX * scale;
			let nextY = (a.y + b.y) / 2 - pinch.worldY * scale;
			if (size) {
				const vpX = viewportXStrip();
				nextX = clampCameraOffset(nextX, scale, size.width, vpX.start, vpX.end);
				nextY = clampCameraOffset(nextY, scale, size.height, 0, window.innerHeight);
			}
			cam.offsetX = nextX;
			cam.offsetY = nextY;
			cam.targetOffsetX = nextX;
			cam.targetOffsetY = nextY;
			return;
		}
		const drag = dragRef.current;
		if (drag && drag.pointerId === e.pointerId) {
			const cam = cameraRef.current;
			const size = mapSizeRef.current;
			let nextX = drag.startOffsetX + (e.clientX - drag.startX);
			let nextY = drag.startOffsetY + (e.clientY - drag.startY);
			if (size) {
				const vpX = viewportXStrip();
				nextX = clampCameraOffset(nextX, cam.scale, size.width, vpX.start, vpX.end);
				nextY = clampCameraOffset(nextY, cam.scale, size.height, 0, window.innerHeight);
			}
			// drag is direct manipulation: write current and target together
			// so the map tracks the cursor 1:1 with no smoothing lag.
			cam.offsetX = nextX;
			cam.offsetY = nextY;
			cam.targetOffsetX = nextX;
			cam.targetOffsetY = nextY;
		}
	};

	const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
		const pointers = pointersRef.current;
		const wasMultiTouch = multiTouchRef.current;
		pointers.delete(e.pointerId);
		if (pointers.size === 0) multiTouchRef.current = false;
		const steer = steerRef.current;
		if (steer && steer.pointerId === e.pointerId) {
			endSteer();
			e.currentTarget.releasePointerCapture(e.pointerId);
			// a quick, still press is a tap — the click the mouse path would
			// deliver. a longer hold was a walk (and a cancelled pointer is
			// neither), so those never click.
			if (
				e.type === "pointerup" &&
				performance.now() - steer.startTime < TAP_MAX_MS &&
				Math.hypot(e.clientX - steer.startX, e.clientY - steer.startY) <=
					CLICK_MAX_TRAVEL_PX
			) {
				fireTileClick(e.clientX, e.clientY);
			}
			return;
		}
		if (pinchRef.current) {
			// a finger changed: re-baseline with the remaining pair, or fall
			// back to a plain pan under the last finger.
			pinchRef.current = capturePinch();
			if (pinchRef.current) return;
			const [rest] = [...pointers.entries()];
			if (rest) {
				const cam = cameraRef.current;
				dragRef.current = {
					pointerId: rest[0],
					button: 0,
					startX: rest[1].x,
					startY: rest[1].y,
					startOffsetX: cam.offsetX,
					startOffsetY: cam.offsetY,
				};
				setIsDragging(true);
			}
			return;
		}
		const drag = dragRef.current;
		if (drag?.pointerId !== e.pointerId) return;
		const travel = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
		const wasLeft = drag.button === 0;
		dragRef.current = null;
		e.currentTarget.releasePointerCapture(e.pointerId);
		setIsDragging(false);
		// no phase of a multi-touch gesture is a click, even the trailing
		// single-finger pan after a pinch.
		if (wasMultiTouch || !wasLeft || travel > CLICK_MAX_TRAVEL_PX) return;
		fireTileClick(e.clientX, e.clientY);
	};

	const onWheel = (e: ReactWheelEvent<HTMLCanvasElement>) => {
		const cam = cameraRef.current;
		const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
		const newScale = clampScale(cam.targetScale * factor);
		if (newScale === cam.targetScale) return;
		cam.targetScale = newScale;
		// following keeps the camera centered on the player, so just change the
		// zoom level and let the follow logic place the offset.
		if (followRef.current) {
			zoomAnchorRef.current = null;
			return;
		}
		// anchor the zoom to the world point under the cursor on the LIVE camera —
		// what the user actually sees there. renderFrame pins this point across
		// every in-between scale, so the focal point neither drifts during the
		// zoom nor snaps when it settles. recapturing each tick is stable because
		// the live offset already keeps this same point under the cursor.
		const anchor = {
			worldX: (e.clientX - cam.offsetX) / cam.scale,
			worldY: (e.clientY - cam.offsetY) / cam.scale,
			screenX: e.clientX,
			screenY: e.clientY,
		};
		zoomAnchorRef.current = anchor;
		const size = mapSizeRef.current;
		const vpX = viewportXStrip();
		const offsetX = anchor.screenX - anchor.worldX * newScale;
		const offsetY = anchor.screenY - anchor.worldY * newScale;
		cam.targetOffsetX = size
			? clampCameraOffset(offsetX, newScale, size.width, vpX.start, vpX.end)
			: offsetX;
		cam.targetOffsetY = size
			? clampCameraOffset(offsetY, newScale, size.height, 0, window.innerHeight)
			: offsetY;
	};

	return {
		canvasProps: {
			ref: canvasRef,
			className: "absolute inset-0 h-full w-full touch-none select-none",
			style: {
				imageRendering: "pixelated",
				cursor: canDrag ? (isDragging ? "grabbing" : "grab") : "default",
			},
			onPointerDown,
			onPointerMove,
			onPointerUp,
			onPointerCancel: onPointerUp,
			// no context menu while a hold-to-walk gesture is active (Android
			// fires it on touch long-press, desktop on right-click mid-steer);
			// plain right-clicks stay untouched.
			onContextMenu: (e) => {
				if (steerRef.current) e.preventDefault();
			},
			onWheel,
		},
		state,
		zoom,
		playerTile,
		isDragging,
	};
}
