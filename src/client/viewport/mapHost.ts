import {
	CharacterRenderer,
	createDebugOverlay,
	DEBUG_OVERLAY_ALL,
	DEFAULT_DEBUG_OVERLAY,
	type DebugOverlay,
} from "@/client/game";
import {memoizeAsync} from "@/client/lib/memoizeAsync";
import {
	drawPerfHud,
	perfCount,
	perfGauge,
	perfHudEnabled,
	perfSample,
	timed,
} from "@/client/lib/perfHud";
import {
	spriteFocus,
	type FollowTarget,
	type GameHooks,
	type GameHostContext,
	type TileClickArgs,
} from "@/client/session/gameHost";
import {browserMapLoaderEnv} from "@/client/tiled/browserEnv";
import {buildMapRenderCache, type MapRenderCache} from "@/client/tiled/renderer";
import {loadTilesets, type LoadedTileset} from "@/client/tiled/tileset";
import {Camera, overlayTextScale, type ViewBounds} from "@/client/viewport/camera";
import {
	advanceCameraOffset,
	applyKeyboardZoom,
	clampScaleFor,
	createViewReporter,
	createZoomPersister,
	easeInsets,
	loadStoredZoom,
	smoothingFactor,
	viewBounds,
	type Insets,
	type ZoomLimits,
} from "@/client/viewport/cameraPolicy";
import {FrameCompositor} from "@/client/viewport/frameCompositor";
import {buildWorldGrids, collisionCenter, World} from "@/shared/game";
import {buildAnimationTable, type AnimationTable} from "@/shared/tiled/animation";
import {loadTiledMap, type TiledMap} from "@/shared/tiled/loadMap";

// max dt we feed the integrator, so a tab regaining focus after a long
// pause doesn't teleport the camera in one step.
const MAX_FRAME_DT = 0.1;

// every parameter the host re-reads each frame. the hook mirrors its props
// into one ref of this shape, so the host (built once per map load) and the
// gesture handlers keep seeing current values without being rebuilt or
// re-bound. anything read once at load belongs in MapHostOpts instead.
export type MapHostParams = ZoomLimits & {
	readonly follow: boolean;
	readonly debug: boolean;
	readonly clickToMove: boolean;
	// reports the viewport extent in world pixels (from the zoom the camera is
	// heading to, so a zoom-out widens the report before the spring settles).
	// throttled and only fired on meaningful change; feeds the server's
	// interest area online.
	readonly onViewChange?: (w: number, h: number) => void;
	// advance simulation by dtMs; return the interpolation alpha (0..1) used
	// when drawing characters between their previous and current poses.
	readonly step: (dtMs: number) => number;
	readonly onTileClick: (args: TileClickArgs) => void;
	readonly insets: Insets;
};

export type MapHostParamsRef = {readonly current: MapHostParams};

export type MapAssets = {readonly map: TiledMap; readonly tilesets: LoadedTileset[]};

// maps and their tilesets are immutable per URL, so keep them for the app's
// lifetime: switching between the online and offline pages (which share a map)
// then remounts without refetching — and without a loading screen. a failed
// load is evicted so a retry refetches.
export const loadMapAssets = memoizeAsync(
	(mapUrl: string) => mapUrl,
	async (mapUrl: string): Promise<MapAssets> => {
		const map = await loadTiledMap(mapUrl, browserMapLoaderEnv);
		const tilesets = await loadTilesets(map, mapUrl);
		return {map, tilesets};
	}
);

// the two per-frame values the host pushes back into React state. each
// publishes only on a change the user could see, so the HUD doesn't re-render
// at frame rate.
export type MapHostPublish = {
	readonly playerTile: (tile: {x: number; y: number} | null) => void;
	// whether a drag could actually pan the map right now — false while the
	// camera is locked to the player (follow) or the map is fully clamped.
	readonly canDrag: (canDrag: boolean) => void;
};

export type MapHostOpts = {
	readonly assets: MapAssets;
	readonly canvas: HTMLCanvasElement;
	readonly ctx: CanvasRenderingContext2D;
	readonly camera: Camera;
	// builds the page's game over the world this host just made. called
	// exactly once, by start() — everything the running host re-reads lives
	// in `params` instead.
	readonly init: (ctx: GameHostContext) => Promise<GameHooks> | GameHooks;
	readonly params: MapHostParamsRef;
	readonly publish: MapHostPublish;
	// polled around every await in start(), so a map torn down mid-load cleans
	// up what it already built instead of finishing into a dead page.
	readonly cancelled: () => boolean;
};

type HostCore = MapHostOpts & {
	readonly world: World;
	readonly renderer: CharacterRenderer;
	readonly animations: AnimationTable;
	readonly game: GameHooks;
	readonly detachResize: () => void;
};

// one map load, live: owns the world, the render loop, and everything the loop
// draws through. the camera math, the camera policy driving it, the pointer
// gestures and the frame compositing each live in their own module; this is
// what runs them. created once the assets and the canvas are both in hand, torn
// down by dispose() — so the hook above it is nothing but load state and React
// wiring.
export class MapHost {
	private readonly opts: HostCore;
	private readonly map: TiledMap;
	private readonly mapPixelWidth: number;
	private readonly mapPixelHeight: number;
	private readonly debugOverlay: DebugOverlay;
	private readonly compositor: FrameCompositor;
	private readonly reportView: (camera: Camera, now: number) => void;
	private readonly persistZoom: (scale: number, now: number) => void;
	private readonly startTime = performance.now();
	// the insets the camera math actually uses; sprung toward the live ones in
	// the render loop so showing/hiding/resizing/side-switching the overlay
	// glides the camera instead of snapping it.
	private readonly easedInsets: Insets;
	private mapCache: MapRenderCache;
	private cacheDebugObjects: boolean;
	private frameHandle = 0;
	private lastFrameTime = 0;
	private hadPlayerTarget = false;

	// builds the world, hands it to the page's `init`, waits for its sprites, and
	// returns a host already running — or null if the load was cancelled along
	// the way. every exit that isn't a live host undoes what it built here,
	// since the host that would own that teardown doesn't exist yet.
	static async start(opts: MapHostOpts): Promise<MapHost | null> {
		const {map} = opts.assets;
		const detachResize = attachResize(opts.canvas);
		const world = new World(buildWorldGrids(map));
		const renderer = new CharacterRenderer();
		let game: GameHooks | null = null;
		const unwind = (): null => {
			teardown(detachResize, game, world);
			return null;
		};
		try {
			game = await opts.init({
				map,
				world,
				renderer,
				mapPixelWidth: map.width * map.tilewidth,
				mapPixelHeight: map.height * map.tileheight,
				screenToWorld: (x, y) => opts.camera.toWorld(x, y),
			});
			if (opts.cancelled()) return unwind();
			await renderer.ensureLoaded(world.characters.values());
			if (opts.cancelled()) return unwind();
		} catch (err) {
			unwind();
			throw err;
		}
		const host = new MapHost({
			...opts,
			world,
			renderer,
			animations: buildAnimationTable(map),
			game,
			detachResize,
		});
		host.run();
		return host;
	}

	private constructor(opts: HostCore) {
		this.opts = opts;
		const {map} = opts.assets;
		this.map = map;
		this.mapPixelWidth = map.width * map.tilewidth;
		this.mapPixelHeight = map.height * map.tileheight;

		// center the viewport on first render — on the requested focus point if
		// init supplied one, otherwise on the map's middle. the zoom picks up
		// where the last host left it, clamped to whatever limits this route
		// applies (an admin's stored zoom stays legal for a non-admin). live and
		// target are set together so the spring has nothing to animate at load.
		this.easedInsets = {...opts.params.current.insets};
		const camera = opts.camera;
		camera.scale = this.clampScaleNow(loadStoredZoom());
		camera.targetScale = camera.scale;
		const focus = opts.game.initialFocus;
		camera.centerOn(
			focus ? focus.x : this.mapPixelWidth / 2,
			focus ? focus.y : this.mapPixelHeight / 2,
			this.viewBounds()
		);

		this.cacheDebugObjects = this.debugOptions().objects;
		this.mapCache = this.buildCache(this.cacheDebugObjects);
		this.debugOverlay = createDebugOverlay(this.mapPixelWidth, this.mapPixelHeight);
		this.compositor = new FrameCompositor(this.mapPixelWidth, this.mapPixelHeight);
		this.reportView = createViewReporter(opts.params.current.onViewChange);
		this.persistZoom = createZoomPersister(camera.scale);
	}

	private run(): void {
		this.frameHandle = requestAnimationFrame(this.renderFrame);
	}

	dispose(): void {
		if (this.frameHandle !== 0) cancelAnimationFrame(this.frameHandle);
		this.frameHandle = 0;
		teardown(this.opts.detachResize, this.opts.game, this.opts.world);
	}

	viewBounds(): ViewBounds {
		return viewBounds(this.mapPixelWidth, this.mapPixelHeight, this.easedInsets);
	}

	// the page's hold-to-walk channel, for the gesture layer to feed.
	steerTo(point: {x: number; y: number} | null): void {
		this.opts.game.onSteer(point);
	}

	handleTileClick(clientX: number, clientY: number): void {
		const map = this.map;
		const [worldX, worldY] = this.opts.camera.toWorld(clientX, clientY);
		const tileX = Math.floor(worldX / map.tilewidth);
		const tileY = Math.floor(worldY / map.tileheight);
		if (tileX < 0 || tileY < 0 || tileX >= map.width || tileY >= map.height) return;
		this.opts.params.current.onTileClick({worldX, worldY, tileX, tileY, map});
	}

	private clampScaleNow(scale: number): number {
		return clampScaleFor(this.opts.params.current, scale);
	}

	private debugOptions() {
		return this.opts.params.current.debug ? DEBUG_OVERLAY_ALL : DEFAULT_DEBUG_OVERLAY;
	}

	// the static map is rasterized once and reused every frame; only animated
	// cells and characters are redrawn. rebuilt only when the object-debug
	// overlay toggles, since that bakes outlines into the static layers.
	private buildCache(debugObjects: boolean): MapRenderCache {
		const {assets, animations} = this.opts;
		const start = performance.now();
		const cache = buildMapRenderCache(
			{
				map: assets.map,
				tilesets: assets.tilesets,
				animations,
				timeMs: 0,
				debugObjects,
			},
			this.mapPixelWidth,
			this.mapPixelHeight
		);
		// the one piece of the pipeline still proportional to map area, and it
		// blocks the main thread while it runs.
		perfGauge("map cache ms", performance.now() - start);
		return cache;
	}

	private readonly renderFrame = (now: number): void => {
		const dt =
			this.lastFrameTime === 0
				? 0
				: Math.min((now - this.lastFrameTime) / 1000, MAX_FRAME_DT);
		perfCount("frames");
		if (this.lastFrameTime !== 0) perfSample("frame gap ms", now - this.lastFrameTime);
		this.lastFrameTime = now;
		timed("frame work ms", () => this.advanceFrame(now, dt));
		this.frameHandle = requestAnimationFrame(this.renderFrame);
	};

	// one frame: bring the camera where this frame's state says it belongs, step
	// the simulation, draw, and publish what React needs out of it.
	private advanceFrame(now: number, dt: number): void {
		const {camera, params, publish, game} = this.opts;
		const dpr = window.devicePixelRatio || 1;
		const k = smoothingFactor(dt);
		const following = params.current.follow;

		applyKeyboardZoom(camera, game.zoomInput(), dt, following);
		// re-clamping the target lets the spring glide the camera into compliance
		// when the window or the caps change.
		camera.targetScale = this.clampScaleNow(camera.targetScale);
		this.reportView(camera, now);

		easeInsets(this.easedInsets, params.current.insets, k);
		const bounds = this.viewBounds();

		// step the simulation first so the camera spring chases this frame's
		// freshly stepped follow target with zero extra latency.
		const alpha = timed("step ms", () => params.current.step(dt * 1000));
		// the local player, resolved every frame whether follow is on or not: the
		// camera only consumes it while following, but the HUD player-tile readout
		// always does.
		const playerTarget = game.follow();
		// when the follow target appears (the welcome placing the self character)
		// and init gave no viewpoint of its own, snap the camera onto it
		// (following or not) — easing would sweep it across the map from a
		// meaningless start. with an initialFocus (mode-switch continuity) the
		// spring instead pans from there.
		if (playerTarget && !this.hadPlayerTarget && !game.initialFocus) {
			const focus = spriteFocus(playerTarget);
			camera.centerOn(focus.x, focus.y, bounds);
			camera.followFocus = null;
		}
		this.hadPlayerTarget = playerTarget !== null;

		// keep the target inside the map bounds (the viewport may have resized, or
		// follow/zoom may have pushed it past an edge).
		camera.clampTarget(bounds);
		if (dt > 0) {
			camera.easeScale(k);
			advanceCameraOffset(camera, following ? playerTarget : null, alpha, k, bounds);
		}
		// the spring tracks a clamped target, but its in-flight scale can
		// momentarily expose the void.
		camera.clampLive(bounds);

		this.compositeFrame(now, dpr, alpha);

		// keep the grab affordance honest: no grab cursor while the left button
		// steers instead of pans (click-to-move), while the camera is locked to
		// the player, or while the clamp leaves no room.
		const leftButtonSteers = params.current.clickToMove;
		publish.canDrag(!leftButtonSteers && !(following && playerTarget) && camera.canPan(bounds));
		// the player's occupied tile inverts the teleport placement in
		// onTileClick, so click-to-teleport round-trips to the shown tile.
		publish.playerTile(playerTarget ? this.occupiedTile(playerTarget) : null);
		this.persistZoom(camera.scale, now);
	}

	// draws one frame of the world: the map (static bitmap + animated cells) and
	// the characters into an offscreen scratch at the camera's scale, blitted to
	// the canvas, then the screen-space overlays on top.
	private compositeFrame(now: number, dpr: number, alpha: number): void {
		const {ctx, camera, world, renderer, game} = this.opts;
		const view = camera.visibleRect(this.mapPixelWidth, this.mapPixelHeight);
		const overlay = this.debugOptions();
		if (overlay.objects !== this.cacheDebugObjects) {
			this.cacheDebugObjects = overlay.objects;
			this.mapCache = this.buildCache(this.cacheDebugObjects);
		}
		const deviceScale = camera.scale * dpr;
		const prescale = Math.max(1, Math.round(deviceScale));
		const scratchCtx = timed("world draw ms", () => {
			const scratch = this.compositor.begin(view, prescale);
			// the static bitmap leaves the animated cells empty; drawing both
			// through the same transform drops the animated frames seamlessly
			// into those gaps.
			scratch.drawImage(
				this.mapCache.staticCanvas,
				view.x,
				view.y,
				view.width,
				view.height,
				view.x,
				view.y,
				view.width,
				view.height
			);
			this.mapCache.drawAnimated(scratch, now - this.startTime, view);
			this.debugOverlay.draw(scratch, world, overlay);
			return scratch;
		});
		// characters draw into the prescaled scratch, where nearest sampling
		// quantizes their sub-pixel positions to 1/prescale of a world pixel —
		// about one device pixel — fine enough that interpolated walking stays
		// smooth (snapping to whole world pixels made it stutter), while keeping
		// sprite pixels on the map's texel grid so they scale exactly like the
		// ground they stand on.
		timed("characters ms", () => renderer.drawAll(scratchCtx, world, view, true, alpha));
		timed("blit ms", () =>
			this.compositor.blit(
				ctx,
				view,
				prescale,
				deviceScale,
				camera.offsetX * dpr,
				camera.offsetY * dpr
			)
		);
		const drawScreenOverlay = game.drawScreenOverlay;
		if (drawScreenOverlay) {
			// switch to CSS-pixel space (DPR only) so overlays render crisp without
			// the camera's nearest-neighbor upscale.
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			ctx.imageSmoothingEnabled = true;
			timed("overlay ms", () =>
				drawScreenOverlay(
					ctx,
					alpha,
					(x, y) => [
						x * camera.scale + camera.offsetX,
						y * camera.scale + camera.offsetY,
					],
					overlayTextScale(camera.scale)
				)
			);
		}
		if (perfHudEnabled) {
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			drawPerfHud(ctx, now);
		}
	}

	private occupiedTile(target: FollowTarget): {x: number; y: number} {
		const center = collisionCenter(target);
		return {
			x: Math.floor(center.x / this.map.tilewidth),
			y: Math.floor(center.y / this.map.tileheight),
		};
	}
}

// everything a host owns, released in one place so the two paths that have
// to release it — a load abandoned before the host exists, and the host's
// own dispose — can't drift apart. the world goes last, and disposing it is what
// unbinds the keyboard provider's window listeners: without that, every teardown
// leaves a suspended-page listener behind that still preventDefaults its (by
// then stale) bound keys, ignoring the live page's modal suspension.
function teardown(detachResize: () => void, game: GameHooks | null, world: World): void {
	detachResize();
	game?.dispose();
	world.dispose();
}

// sizes the backing store to the window in device pixels, now and on every
// resize. returns the detach.
function attachResize(canvas: HTMLCanvasElement): () => void {
	const resize = () => {
		const dpr = window.devicePixelRatio || 1;
		canvas.width = Math.floor(window.innerWidth * dpr);
		canvas.height = Math.floor(window.innerHeight * dpr);
	};
	resize();
	window.addEventListener("resize", resize);
	return () => window.removeEventListener("resize", resize);
}
