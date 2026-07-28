import type {Aabb} from "@/shared/lib/rect";
import {resolveAnimatedTileId, type AnimationTable} from "@/shared/tiled/animation";
import {decodeTileGid, EMPTY_TILE_ID, type TileFlip} from "@/shared/tiled/gid";
import type {TiledMap} from "@/shared/tiled/loadMap";
import type {
	ITiledMapGroupLayer,
	ITiledMapObjectLayer,
	ITiledMapTileLayer,
} from "@workadventure/tiled-map-type-guard";
import {drawTile} from "./drawTile";
import {drawObjectLayer} from "./objects";
import {findTileImageRect, type LoadedTileset, type TileImageRect} from "./tileset";

type TiledLayer = TiledMap["layers"][number];

export type RenderContext = {
	readonly map: TiledMap;
	readonly tilesets: readonly LoadedTileset[];
	readonly animations: AnimationTable;
	readonly timeMs: number;
	readonly debugObjects: boolean;
};

// map-square the animated cells are bucketed by. small enough that the cells a
// frame draws stay close to the ones actually on screen, large enough that the
// bucket walk stays a handful of lookups.
const CHUNK_TILES = 8;

// a single animated tile-layer cell, captured once so the per-frame redraw
// doesn't have to rescan the whole map. dx/dy are absolute map pixels, alpha
// the composited group+layer opacity at that cell.
type AnimatedCell = {
	readonly baseId: number;
	readonly flip: TileFlip;
	readonly alpha: number;
	readonly dx: number;
	readonly dy: number;
};

// the overwhelming majority of map tiles never change between frames, so the
// static layers are rasterized once into `staticCanvas` and only the animated
// cells are redrawn. both halves are addressed by viewport: the caller blits a
// sub-rect of the bitmap, and drawAnimated walks only the chunks that rect
// covers — so frame cost tracks the screen, not the size of the map.
export type MapRenderCache = {
	readonly staticCanvas: HTMLCanvasElement;
	// stamps the current frame of every animated cell near `view` (world pixels)
	// onto ctx, which must be in world-pixel space. the static bitmap leaves
	// those cells empty, so semi-transparent tiles composite once, not twice.
	drawAnimated(ctx: CanvasRenderingContext2D, timeMs: number, view: Aabb): void;
};

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
	const tileRect = createTileRectLookup(scene.tilesets);
	const animated = createAnimatedTiles(scene.map, scene.animations, tileRect);
	for (const layer of scene.map.layers) drawLayer(ctx, layer, scene, tileRect, animated);
	return {staticCanvas: canvas, drawAnimated: animated.draw};
}

type TileRectLookup = (tileId: number) => TileImageRect | null;

// resolving a tile id walks every tileset and allocates a rect, which the
// per-frame animated pass would otherwise pay for on every cell. tilesets are
// immutable per map, so the answer is memoizable for the cache's lifetime.
function createTileRectLookup(tilesets: readonly LoadedTileset[]): TileRectLookup {
	const rects = new Map<number, TileImageRect | null>();
	return (tileId) => {
		const cached = rects.get(tileId);
		if (cached !== undefined) return cached;
		const rect = findTileImageRect(tilesets, tileId);
		rects.set(tileId, rect);
		return rect;
	};
}

type AnimatedTiles = {
	add(cell: AnimatedCell): void;
	draw(ctx: CanvasRenderingContext2D, timeMs: number, view: Aabb): void;
};

// animated cells bucketed into square chunks of the map so a frame walks only
// the ones the camera is near. cells keep insertion order within a chunk, which
// is layer order, so cells stacked on one spot still composite bottom-up.
function createAnimatedTiles(
	map: TiledMap,
	animations: AnimationTable,
	tileRect: TileRectLookup
): AnimatedTiles {
	const chunkWidth = CHUNK_TILES * map.tilewidth;
	const chunkHeight = CHUNK_TILES * map.tileheight;
	const columns = Math.ceil(map.width / CHUNK_TILES);
	const rows = Math.ceil(map.height / CHUNK_TILES);
	const byChunk = new Map<number, AnimatedCell[]>();
	const chunkKey = (column: number, row: number) => row * columns + column;
	return {
		add(cell) {
			const key = chunkKey(
				Math.floor(cell.dx / chunkWidth),
				Math.floor(cell.dy / chunkHeight)
			);
			const bucket = byChunk.get(key);
			if (bucket) bucket.push(cell);
			else byChunk.set(key, [cell]);
		},
		draw(ctx, timeMs, view) {
			if (byChunk.size === 0) return;
			const firstColumn = Math.max(0, Math.floor(view.x / chunkWidth));
			const lastColumn = Math.min(
				columns - 1,
				Math.floor((view.x + view.width) / chunkWidth)
			);
			const firstRow = Math.max(0, Math.floor(view.y / chunkHeight));
			const lastRow = Math.min(rows - 1, Math.floor((view.y + view.height) / chunkHeight));
			const previousAlpha = ctx.globalAlpha;
			for (let row = firstRow; row <= lastRow; row++) {
				for (let column = firstColumn; column <= lastColumn; column++) {
					const bucket = byChunk.get(chunkKey(column, row));
					if (!bucket) continue;
					for (const cell of bucket) {
						const rect = tileRect(
							resolveAnimatedTileId(animations, cell.baseId, timeMs)
						);
						if (!rect) continue;
						ctx.globalAlpha = cell.alpha;
						drawTile(
							ctx,
							rect,
							cell.dx,
							cell.dy,
							map.tilewidth,
							map.tileheight,
							cell.flip
						);
					}
				}
			}
			ctx.globalAlpha = previousAlpha;
		},
	};
}

function drawLayer(
	ctx: CanvasRenderingContext2D,
	layer: TiledLayer,
	scene: RenderContext,
	tileRect: TileRectLookup,
	animated: AnimatedTiles
): void {
	if (!layer.visible) return;
	if (isTileLayer(layer)) drawTileLayer(ctx, layer, scene, tileRect, animated);
	else if (isGroupLayer(layer)) drawGroupLayer(ctx, layer, scene, tileRect, animated);
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
	tileRect: TileRectLookup,
	animated: AnimatedTiles
): void {
	const previousAlpha = ctx.globalAlpha;
	ctx.globalAlpha = previousAlpha * layer.opacity;
	for (const child of layer.layers) drawLayer(ctx, child, scene, tileRect, animated);
	ctx.globalAlpha = previousAlpha;
}

// animated cells are handed to `animated` and deliberately left out of the
// static bitmap, so the per-frame redraw can stamp the current frame on top
// without double-compositing (matters for semi-transparent animated tiles).
function drawTileLayer(
	ctx: CanvasRenderingContext2D,
	layer: ITiledMapTileLayer,
	scene: RenderContext,
	tileRect: TileRectLookup,
	animated: AnimatedTiles
): void {
	if (!Array.isArray(layer.data)) return;
	const previousAlpha = ctx.globalAlpha;
	ctx.globalAlpha = previousAlpha * layer.opacity;
	const {map, animations} = scene;
	for (let i = 0; i < layer.data.length; i++) {
		const gid = layer.data[i];
		if (gid === EMPTY_TILE_ID) continue;
		const {id, flip} = decodeTileGid(gid);
		const dx = (i % layer.width) * map.tilewidth;
		const dy = Math.floor(i / layer.width) * map.tileheight;
		if (animations.has(id)) {
			animated.add({baseId: id, flip, alpha: ctx.globalAlpha, dx, dy});
			continue;
		}
		const rect = tileRect(id);
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
