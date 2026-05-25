import {type ChatMessage} from "@/components/Chat";
import ChatPanel from "@/components/ChatPanel";

import {
	buildCliffGrid,
	buildHoleGrid,
	buildSolidGrid,
	buildTerrainGrid,
	CharacterRenderer,
	createBasicCharacter,
	DEFAULT_TICK_RATE_HZ,
	GameClock,
	KeyboardInputProvider,
	RandomInputProvider,
	resolveCharacterCollision,
	World,
	type BasicCharacter,
} from "@/game";
import {LinkSpriteAsset} from "@/sprites/assets/link";
import {NayruSpriteAsset} from "@/sprites/assets/nayru";
import {buildAnimationTable} from "@/tiled/animation";
import {loadTiledMap, type TiledMap} from "@/tiled/loadMap";
import {renderTiledMap} from "@/tiled/renderer";
import {loadTilesets} from "@/tiled/tileset";
import {useEffect, useRef, useState, type PointerEvent, type WheelEvent} from "react";

const MAP_URL = "/maps/overworld.json";
const INITIAL_SCALE = 2;
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
const PLAYER_CHARACTER_ID = "player-link";
const NPC_CHARACTER_ID = "npc-nayru";
const MIN_TICK_RATE_HZ = 5;
const MAX_TICK_RATE_HZ = 120;

const CURRENT_USER = {name: "pixelwitch", color: "#1E90FF"};
const SEED_AVATAR = "/images/sprites/windfish.png";

type SeedEntry =
	| {kind: "chat"; name: string; color: string; text: string}
	| {kind: "system"; text: string};

// seed transcript: built once at module load. timestamps are randomized within
// the last hour and then sorted so the visible order still reads like a real
// chronological chat backlog.
const SEED_ENTRIES: SeedEntry[] = [
	{kind: "system", text: "welcome to koholint chat"},
	{
		kind: "chat",
		name: "linkmainas",
		color: "#FF0000",
		text: "anyone find the boss key in turtle rock?",
	},
	{
		kind: "chat",
		name: "moblinhunter",
		color: "#FF7F50",
		text: "yeah, sw corner. cracked wall, bomb it",
	},
	{kind: "chat", name: "linkmainas", color: "#FF0000", text: "ty"},
	{
		kind: "chat",
		name: "marin_dreams",
		color: "#DAA520",
		text: "playing dx for the nth time, the colors still pop",
	},
	{
		kind: "chat",
		name: "crowsong",
		color: "#8A2BE2",
		text: "first time on the original, where do i get the bow",
	},
	{kind: "system", text: "be kind — koholint is small"},
	{kind: "chat", name: "tarinfan", color: "#FF69B4", text: "level 7 i think? eagle's tower"},
	{
		kind: "chat",
		name: "riptide99",
		color: "#9ACD32",
		text: "yeah it's eagle's tower. tail cave is just roc's feather",
	},
	{
		kind: "chat",
		name: "saltbreeze",
		color: "#00FF7F",
		text: "bow + arrows show up pretty late, don't stress it",
	},
	{kind: "chat", name: "crowsong", color: "#8A2BE2", text: "ok thx"},
	{kind: "chat", name: "pixelwitch", color: "#1E90FF", text: "marin's ballad still slaps"},
	{kind: "chat", name: "waveform", color: "#DAA520", text: "anyone speedrunning today?"},
	{
		kind: "chat",
		name: "shellracer",
		color: "#FF0000",
		text: "any% wr is wild, sub 4 minutes now",
	},
	{kind: "chat", name: "moblinhunter", color: "#FF7F50", text: "the kanalet skip is so clean"},
	{kind: "system", text: "moblinhunter has been here 32 days"},
	{kind: "chat", name: "tarinfan", color: "#FF69B4", text: ""},
	{
		kind: "chat",
		name: "marin_dreams",
		color: "#DAA520",
		text: "",
	},
];

const SEED_REPEAT = 5;

const SEED_MESSAGES: ChatMessage[] = (() => {
	const now = Date.now();
	const entries = Array.from({length: SEED_REPEAT}, () => SEED_ENTRIES).flat();
	const offsets = entries.map(() => Math.floor(Math.random() * 3600000)).sort((a, b) => b - a);
	return entries.map((e, i) => {
		const timestamp = now - offsets[i];
		const id = crypto.randomUUID();
		return e.kind === "chat"
			? {
					id,
					kind: "chat",
					name: e.name,
					color: e.color,
					text: e.text,
					timestamp,
					avatarUrl: SEED_AVATAR,
			  }
			: {id, kind: "system", text: e.text, timestamp};
	});
})();

type LoadState =
	| {status: "loading"}
	| {status: "ok"; map: TiledMap}
	| {status: "error"; message: string};

type Camera = {
	scale: number;
	offsetX: number;
	offsetY: number;
	targetScale: number;
	targetOffsetX: number;
	targetOffsetY: number;
};

function MapPage() {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const debugRef = useRef(false);
	const cameraRef = useRef<Camera>({
		scale: INITIAL_SCALE,
		offsetX: 0,
		offsetY: 0,
		targetScale: INITIAL_SCALE,
		targetOffsetX: 0,
		targetOffsetY: 0,
	});
	const dragRef = useRef<{
		pointerId: number;
		button: number;
		startX: number;
		startY: number;
		startOffsetX: number;
		startOffsetY: number;
	} | null>(null);
	const mouseRef = useRef<{x: number; y: number} | null>(null);
	const displayedZoomRef = useRef(INITIAL_SCALE);
	const displayedCursorRef = useRef<{x: number; y: number} | null>(null);
	const followRef = useRef(true);
	const gameRef = useRef<{
		world: World;
		clock: GameClock;
		renderer: CharacterRenderer;
		player: BasicCharacter;
	} | null>(null);
	const tickRateRef = useRef(DEFAULT_TICK_RATE_HZ);
	const [state, setState] = useState<LoadState>({status: "loading"});
	const [debug, setDebug] = useState(false);
	const [zoom, setZoom] = useState(INITIAL_SCALE);
	const [cursor, setCursor] = useState<{x: number; y: number} | null>(null);
	const [isDragging, setIsDragging] = useState(false);
	const [follow, setFollow] = useState(true);
	const [tickRate, setTickRate] = useState(DEFAULT_TICK_RATE_HZ);

	useEffect(() => {
		debugRef.current = debug;
	}, [debug]);

	useEffect(() => {
		followRef.current = follow;
	}, [follow]);

	useEffect(() => {
		tickRateRef.current = tickRate;
		gameRef.current?.clock.setTickRate(tickRate);
	}, [tickRate]);

	useEffect(() => {
		let cancelled = false;
		let frameHandle = 0;
		(async () => {
			try {
				const map = await loadTiledMap(MAP_URL);
				const tilesets = await loadTilesets(map, MAP_URL);
				if (cancelled) return;
				const canvas = canvasRef.current;
				const ctx = canvas?.getContext("2d") ?? null;
				if (canvas && ctx) {
					const resize = () => {
						const dpr = window.devicePixelRatio || 1;
						canvas.width = Math.floor(window.innerWidth * dpr);
						canvas.height = Math.floor(window.innerHeight * dpr);
					};
					resize();
					window.addEventListener("resize", resize);
					const animations = buildAnimationTable(map);
					// render the whole map at 1:1 into an offscreen canvas, then
					// upscale that single bitmap with the camera transform. drawing
					// the tiles directly through a scaled transform produces 1px
					// seams between tiles at non-integer zoom levels.
					const mapPixelWidth = map.width * map.tilewidth;
					const mapPixelHeight = map.height * map.tileheight;
					const solidGrid = buildSolidGrid(map);
					const terrainGrid = buildTerrainGrid(map);
					const holeGrid = buildHoleGrid(map);
					const cliffGrid = buildCliffGrid(map);
					const world = new World(solidGrid, {
						terrain: terrainGrid,
						holes: holeGrid,
						cliffs: cliffGrid,
					});
					const clock = new GameClock(tickRateRef.current);
					const renderer = new CharacterRenderer();
					const playerStart = {
						x: mapPixelWidth / 2 - 8,
						y: mapPixelHeight / 2 - 8,
					};
					const player = createBasicCharacter({
						id: PLAYER_CHARACTER_ID,
						sprite: LinkSpriteAsset,
						x: playerStart.x,
						y: playerStart.y,
					});
					const npc = createBasicCharacter({
						id: NPC_CHARACTER_ID,
						sprite: NayruSpriteAsset,
						x: playerStart.x + 32,
						y: playerStart.y,
					});
					world.addCharacter(player, new KeyboardInputProvider());
					world.addCharacter(npc, new RandomInputProvider());
					gameRef.current = {world, clock, renderer, player};
					await renderer.ensureLoaded(world.characters.values());
					if (cancelled) return;
					// center the map in the viewport on first render. set current
					// and target to the same value so the spring has nothing to
					// animate at load.
					const initialOffsetX = (window.innerWidth - mapPixelWidth * INITIAL_SCALE) / 2;
					const initialOffsetY =
						(window.innerHeight - mapPixelHeight * INITIAL_SCALE) / 2;
					cameraRef.current = {
						scale: INITIAL_SCALE,
						offsetX: initialOffsetX,
						offsetY: initialOffsetY,
						targetScale: INITIAL_SCALE,
						targetOffsetX: initialOffsetX,
						targetOffsetY: initialOffsetY,
					};
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

						// integrate the camera spring toward its target. exp-based
						// lerp is frame-rate independent and naturally interruptible.
						const dt =
							lastFrameTime === 0
								? 0
								: Math.min((now - lastFrameTime) / 1000, MAX_FRAME_DT);
						lastFrameTime = now;

						// advance the fixed-step simulation by however many ticks
						// fit into this frame's elapsed time. doing this before the
						// camera spring so the spring chases this frame's freshly
						// stepped player position with zero extra latency.
						clock.advance(dt * 1000, (tick, dtSec) => world.step(tick, dtSec));
						const alpha = clock.getInterpolationAlpha();
						if (followRef.current) {
							const interpX = player.prevX + (player.x - player.prevX) * alpha;
							const interpY = player.prevY + (player.y - player.prevY) * alpha;
							const centerX = interpX + player.spriteWidth / 2;
							const centerY = interpY + player.spriteHeight / 2;
							cam.targetOffsetX = window.innerWidth / 2 - centerX * cam.targetScale;
							cam.targetOffsetY = window.innerHeight / 2 - centerY * cam.targetScale;
						}

						if (dt > 0) {
							const k = 1 - Math.exp(-CAMERA_SMOOTHING * dt);
							cam.scale += (cam.targetScale - cam.scale) * k;
							cam.offsetX += (cam.targetOffsetX - cam.offsetX) * k;
							cam.offsetY += (cam.targetOffsetY - cam.offsetY) * k;
							// snap once we're within sub-pixel / sub-percent distance
							// so the spring doesn't tail off into floating-point noise.
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
						renderTiledMap(offCtx, {
							map,
							tilesets,
							animations,
							timeMs: elapsedMs,
							debug: debugRef.current,
						});
						renderer.drawAll(offCtx, world, true, alpha);
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
					return () => window.removeEventListener("resize", resize);
				}
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
			gameRef.current?.world.dispose();
			gameRef.current = null;
		};
	}, []);

	const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
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

	const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
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

	const onPointerUp = (e: PointerEvent<HTMLCanvasElement>) => {
		const drag = dragRef.current;
		if (drag?.pointerId === e.pointerId) {
			const travel = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
			const wasLeft = drag.button === 0;
			dragRef.current = null;
			e.currentTarget.releasePointerCapture(e.pointerId);
			setIsDragging(false);
			if (wasLeft && travel <= CLICK_MAX_TRAVEL_PX)
				teleportPlayerToClient(e.clientX, e.clientY);
		}
	};

	// teleports the player so their collision box is centered on the tile under
	// the given client point. snaps prev = current to suppress the renderer's
	// inter-tick lerp, cancels any in-flight hop, and nudges out of solids.
	const teleportPlayerToClient = (clientX: number, clientY: number) => {
		const game = gameRef.current;
		const loaded = state.status === "ok" ? state.map : null;
		if (!game || !loaded) return;
		const cam = cameraRef.current;
		const worldX = (clientX - cam.offsetX) / cam.scale;
		const worldY = (clientY - cam.offsetY) / cam.scale;
		const tileX = Math.floor(worldX / loaded.tilewidth);
		const tileY = Math.floor(worldY / loaded.tileheight);
		if (tileX < 0 || tileY < 0 || tileX >= loaded.width || tileY >= loaded.height) return;
		const tileCenterX = (tileX + 0.5) * loaded.tilewidth;
		const tileCenterY = (tileY + 0.5) * loaded.tileheight;
		const {player} = game;
		const box = player.collisionBox;
		player.x = tileCenterX - (box.x + box.width / 2);
		player.y = tileCenterY - (box.y + box.height / 2);
		player.prevX = player.x;
		player.prevY = player.y;
		player.jump = null;
		player.jumpOffsetY = 0;
		player.prevJumpOffsetY = 0;
		player.walking = false;
		player.animTimeMs = 0;
		resolveCharacterCollision(player, game.world.grid, game.world.holes);
	};

	const onWheel = (e: WheelEvent<HTMLCanvasElement>) => {
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

	const map = state.status === "ok" ? state.map : null;
	const tileX = map && cursor ? Math.floor(cursor.x / map.tilewidth) : null;
	const tileY = map && cursor ? Math.floor(cursor.y / map.tileheight) : null;

	return (
		<div className="fixed inset-0 overflow-hidden bg-neutral-900 font-mono">
			<canvas
				ref={canvasRef}
				className="absolute inset-0 h-full w-full touch-none select-none"
				style={{
					imageRendering: "pixelated",
					cursor: isDragging ? "grabbing" : "grab",
				}}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={onPointerUp}
				onWheel={onWheel}
			/>
			<ChatPanel currentUser={CURRENT_USER} initialMessages={SEED_MESSAGES} />
			<div className="absolute top-2 left-2 rounded bg-black/70 p-3 text-xs text-neutral-100 shadow-lg backdrop-blur">
				{state.status === "loading" && <p>loading map…</p>}
				{state.status === "error" && (
					<pre className="whitespace-pre-wrap text-red-400">{state.message}</pre>
				)}
				<div className="flex flex-col gap-2">
					<label className="flex items-center gap-2">
						<input
							type="checkbox"
							checked={debug}
							onChange={(e) => setDebug(e.target.checked)}
						/>
						debug overlay
					</label>
					<label className="flex items-center gap-2">
						<input
							type="checkbox"
							checked={follow}
							onChange={(e) => setFollow(e.target.checked)}
						/>
						follow player (wasd / arrows)
					</label>
					<label className="flex items-center gap-2">
						<span className="text-neutral-400">tick rate</span>
						<input
							type="range"
							min={MIN_TICK_RATE_HZ}
							max={MAX_TICK_RATE_HZ}
							step={1}
							value={tickRate}
							onChange={(e) => setTickRate(Number(e.target.value))}
						/>
						<span className="tabular-nums">{tickRate} Hz</span>
					</label>
				</div>
				<div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 tabular-nums">
					<span className="text-neutral-400">zoom</span>
					<span>{zoom.toFixed(2)}x</span>
					<span className="text-neutral-400">pixel</span>
					<span>{cursor ? `${Math.floor(cursor.x)}, ${Math.floor(cursor.y)}` : "—"}</span>
					<span className="text-neutral-400">tile</span>
					<span>{tileX !== null && tileY !== null ? `${tileX}, ${tileY}` : "—"}</span>
				</div>
			</div>
		</div>
	);
}

export default MapPage;
