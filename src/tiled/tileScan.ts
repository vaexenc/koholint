import type {
	ITiledMapObject,
	ITiledMapObjectLayer,
	ITiledMapTile,
} from "@workadventure/tiled-map-type-guard";
import {decodeTileGid, EMPTY_TILE_ID, type TileFlip} from "./gid";
import type {TiledMap} from "./loadMap";

export type TiledProperty = NonNullable<ITiledMapObject["properties"]>[number];

export type TileLayerView = {
	readonly data: number[];
	readonly width: number;
};

export function* iterateTileLayers(map: TiledMap): Generator<TileLayerView> {
	const stack: TiledMap["layers"][number][] = [...map.layers];
	while (stack.length > 0) {
		const layer = stack.pop()!;
		if (layer.type === "tilelayer" && Array.isArray(layer.data))
			yield {data: layer.data as number[], width: layer.width};
		else if (layer.type === "group") stack.push(...layer.layers);
	}
}

export function* iterateObjectLayers(map: TiledMap): Generator<ITiledMapObjectLayer> {
	const stack: TiledMap["layers"][number][] = [...map.layers];
	while (stack.length > 0) {
		const layer = stack.pop()!;
		if (layer.type === "objectgroup") yield layer;
		else if (layer.type === "group") stack.push(...layer.layers);
	}
}

export function hasBoolProperty(
	properties: ReadonlyArray<TiledProperty> | undefined,
	name: string
): boolean {
	if (!properties) return false;
	return properties.some((p) => p.name === name && p.type === "bool" && p.value === true);
}

// returns every absolute tile gid whose tileset definition tags it with a
// boolean property set to true. used to bridge "this tileset tile means X"
// metadata into per-cell grids the simulation can sample cheaply.
export function collectTileIdsWithBoolProperty(map: TiledMap, name: string): Set<number> {
	return new Set(collectTilesWithBoolProperty(map, name).keys());
}

// richer sibling of collectTileIdsWithBoolProperty: also returns the tileset
// tile definition so callers that need per-tile metadata (e.g. objectgroup
// sub-rectangles for custom collision shapes) don't have to re-scan tilesets.
export function collectTilesWithBoolProperty(
	map: TiledMap,
	name: string
): Map<number, ITiledMapTile> {
	const out = new Map<number, ITiledMapTile>();
	for (const tileset of map.tilesets) {
		if (!("firstgid" in tileset) || tileset.firstgid === undefined) continue;
		const tiles = "tiles" in tileset ? tileset.tiles : undefined;
		if (!tiles) continue;
		for (const tile of tiles) {
			if (hasBoolProperty(tile.properties, name)) out.set(tileset.firstgid + tile.id, tile);
		}
	}
	return out;
}

// walks every tile layer once and invokes `visit(col, row)` for each cell
// whose decoded gid appears in `ids`. flips are stripped via decodeTileGid
// since orientation never changes a tile's semantic tag.
export function forEachTaggedCell(
	map: TiledMap,
	ids: ReadonlySet<number>,
	visit: (col: number, row: number) => void
): void {
	forEachTaggedCellWithGid(map, ids, (col, row) => visit(col, row));
}

// like forEachTaggedCell but also passes the decoded tile id and flip flags so
// visitors can look up per-tile metadata and re-orient it to match how the
// cell is actually drawn.
export function forEachTaggedCellWithGid(
	map: TiledMap,
	ids: ReadonlySet<number>,
	visit: (col: number, row: number, id: number, flip: TileFlip) => void
): void {
	if (ids.size === 0) return;
	for (const layer of iterateTileLayers(map)) {
		for (let i = 0; i < layer.data.length; i++) {
			const gid = layer.data[i];
			if (gid === EMPTY_TILE_ID) continue;
			const {id, flip} = decodeTileGid(gid);
			if (!ids.has(id)) continue;
			visit(i % layer.width, Math.floor(i / layer.width), id, flip);
		}
	}
}
