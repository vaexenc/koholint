import type {
	ITiledMapGroupLayer,
	ITiledMapObjectLayer,
	ITiledMapTileLayer,
} from "@workadventure/tiled-map-type-guard";
import {resolveAnimatedTileId, type AnimationTable} from "./animation";
import {drawTile} from "./drawTile";
import {decodeTileGid, EMPTY_TILE_ID, type TileFlip} from "./gid";
import type {TiledMap} from "./loadMap";
import {drawObjectLayer} from "./objects";
import {findTileImageRect, type LoadedTileset} from "./tileset";

type TiledLayer = TiledMap["layers"][number];

export type RenderContext = {
	readonly map: TiledMap;
	readonly tilesets: readonly LoadedTileset[];
	readonly animations: AnimationTable;
	readonly timeMs: number;
	readonly debugObjects: boolean;
};

// a single animated tile-layer cell, captured once so the per-frame redraw
// doesn't have to rescan the whole map. dx/dy are absolute map pixels, alpha
// the composited group+layer opacity at that cell.
type AnimatedCell = {
	readonly baseId: number;
	readonly flip: TileFlip;
	readonly alpha: number;
	readonly dx: number;
	readonly dy: number;
	readonly dw: number;
	readonly dh: number;
};

// the overwhelming majority of map tiles never change between frames. rendering
// all of them every frame is what makes a large map drop fps, so we rasterize
// the static layers once into `staticCanvas` and keep only the handful of
// animated cells around for a cheap per-frame redraw (see drawMapCache).
export type MapRenderCache = {
	readonly staticCanvas: HTMLCanvasElement;
	readonly animatedCells: readonly AnimatedCell[];
};

export function renderTiledMap(ctx: CanvasRenderingContext2D, scene: RenderContext): void {
	ctx.imageSmoothingEnabled = false;
	for (const layer of scene.map.layers) drawLayer(ctx, layer, scene, null);
}

// rasterizes every static tile into an offscreen bitmap and returns it together
// with the animated cells, which are deliberately left out of the bitmap so the
// per-frame redraw can stamp the current frame on top without double-compositing
// (matters for semi-transparent animated tiles).
export function buildMapRenderCache(
	scene: RenderContext,
	width: number,
	height: number
): MapRenderCache {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("failed to create map cache 2d context");
	ctx.imageSmoothingEnabled = false;
	const animatedCells: AnimatedCell[] = [];
	for (const layer of scene.map.layers) drawLayer(ctx, layer, scene, animatedCells);
	return {staticCanvas: canvas, animatedCells};
}

// composites a cached map for one frame: the static bitmap plus the current
// frame of each animated cell. clears first so a previous frame's sprites left
// over transparent map gaps don't ghost.
export function drawMapCache(
	ctx: CanvasRenderingContext2D,
	cache: MapRenderCache,
	tilesets: readonly LoadedTileset[],
	animations: AnimationTable,
	timeMs: number,
	width: number,
	height: number
): void {
	ctx.imageSmoothingEnabled = false;
	ctx.clearRect(0, 0, width, height);
	ctx.drawImage(cache.staticCanvas, 0, 0);
	const previousAlpha = ctx.globalAlpha;
	for (const cell of cache.animatedCells) {
		const resolvedId = resolveAnimatedTileId(animations, cell.baseId, timeMs);
		const rect = findTileImageRect(tilesets, resolvedId);
		if (!rect) continue;
		ctx.globalAlpha = cell.alpha;
		drawTile(ctx, rect, cell.dx, cell.dy, cell.dw, cell.dh, cell.flip);
	}
	ctx.globalAlpha = previousAlpha;
}

// `sink` non-null means we're building the static cache: animated tile cells are
// recorded into it and skipped here instead of being drawn. null means a plain
// full render that draws everything at scene.timeMs.
function drawLayer(
	ctx: CanvasRenderingContext2D,
	layer: TiledLayer,
	scene: RenderContext,
	sink: AnimatedCell[] | null
): void {
	if (!layer.visible) return;
	if (isTileLayer(layer)) drawTileLayer(ctx, layer, scene, sink);
	else if (isGroupLayer(layer)) drawGroupLayer(ctx, layer, scene, sink);
	else if (isObjectLayer(layer))
		drawObjectLayer(
			ctx,
			layer,
			scene.tilesets,
			scene.animations,
			scene.timeMs,
			scene.debugObjects
		);
}

function drawGroupLayer(
	ctx: CanvasRenderingContext2D,
	layer: ITiledMapGroupLayer,
	scene: RenderContext,
	sink: AnimatedCell[] | null
): void {
	const previousAlpha = ctx.globalAlpha;
	ctx.globalAlpha = previousAlpha * layer.opacity;
	for (const child of layer.layers) drawLayer(ctx, child, scene, sink);
	ctx.globalAlpha = previousAlpha;
}

function drawTileLayer(
	ctx: CanvasRenderingContext2D,
	layer: ITiledMapTileLayer,
	scene: RenderContext,
	sink: AnimatedCell[] | null
): void {
	if (!Array.isArray(layer.data)) return;
	const previousAlpha = ctx.globalAlpha;
	ctx.globalAlpha = previousAlpha * layer.opacity;
	const {map, tilesets, animations, timeMs} = scene;
	for (let i = 0; i < layer.data.length; i++) {
		const gid = layer.data[i];
		if (gid === EMPTY_TILE_ID) continue;
		const {id, flip} = decodeTileGid(gid);
		const dx = (i % layer.width) * map.tilewidth;
		const dy = Math.floor(i / layer.width) * map.tileheight;
		if (sink && animations.has(id)) {
			sink.push({
				baseId: id,
				flip,
				alpha: ctx.globalAlpha,
				dx,
				dy,
				dw: map.tilewidth,
				dh: map.tileheight,
			});
			continue;
		}
		const resolvedId = resolveAnimatedTileId(animations, id, timeMs);
		const rect = findTileImageRect(tilesets, resolvedId);
		if (!rect) continue;
		drawTile(ctx, rect, dx, dy, map.tilewidth, map.tileheight, flip);
	}
	ctx.globalAlpha = previousAlpha;
}

function isTileLayer(layer: TiledLayer): layer is ITiledMapTileLayer {
	return layer.type === "tilelayer";
}

function isGroupLayer(layer: TiledLayer): layer is ITiledMapGroupLayer {
	return layer.type === "group";
}

function isObjectLayer(layer: TiledLayer): layer is ITiledMapObjectLayer {
	return layer.type === "objectgroup";
}
