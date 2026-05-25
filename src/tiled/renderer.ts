import type {
	ITiledMapGroupLayer,
	ITiledMapObjectLayer,
	ITiledMapTileLayer,
} from "@workadventure/tiled-map-type-guard";
import {resolveAnimatedTileId, type AnimationTable} from "./animation";
import {drawTile} from "./drawTile";
import {decodeTileGid, EMPTY_TILE_ID} from "./gid";
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

export function renderTiledMap(ctx: CanvasRenderingContext2D, scene: RenderContext): void {
	ctx.imageSmoothingEnabled = false;
	for (const layer of scene.map.layers) drawLayer(ctx, layer, scene);
}

function drawLayer(ctx: CanvasRenderingContext2D, layer: TiledLayer, scene: RenderContext): void {
	if (!layer.visible) return;
	if (isTileLayer(layer)) drawTileLayer(ctx, layer, scene);
	else if (isGroupLayer(layer)) drawGroupLayer(ctx, layer, scene);
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
	scene: RenderContext
): void {
	const previousAlpha = ctx.globalAlpha;
	ctx.globalAlpha = previousAlpha * layer.opacity;
	for (const child of layer.layers) drawLayer(ctx, child, scene);
	ctx.globalAlpha = previousAlpha;
}

function drawTileLayer(
	ctx: CanvasRenderingContext2D,
	layer: ITiledMapTileLayer,
	scene: RenderContext
): void {
	if (!Array.isArray(layer.data)) return;
	const previousAlpha = ctx.globalAlpha;
	ctx.globalAlpha = previousAlpha * layer.opacity;
	const {map, tilesets, animations, timeMs} = scene;
	for (let i = 0; i < layer.data.length; i++) {
		const gid = layer.data[i];
		if (gid === EMPTY_TILE_ID) continue;
		const {id, flip} = decodeTileGid(gid);
		const resolvedId = resolveAnimatedTileId(animations, id, timeMs);
		const rect = findTileImageRect(tilesets, resolvedId);
		if (!rect) continue;
		const col = i % layer.width;
		const row = Math.floor(i / layer.width);
		drawTile(
			ctx,
			rect,
			col * map.tilewidth,
			row * map.tileheight,
			map.tilewidth,
			map.tileheight,
			flip
		);
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
