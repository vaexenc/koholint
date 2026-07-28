import type {Aabb} from "@/shared/lib/rect";
import type {TileFlip} from "@/shared/tiled/gid";
import type {TiledMap} from "@/shared/tiled/loadMap";
import {
	collectTilesWithStringProperty,
	forEachTaggedCellWithGid,
	objectAabb,
} from "@/shared/tiled/tileScan";
import {EPSILON} from "./cellGrid";
import {
	aabbOverlapsHole,
	aabbsOverlap,
	isAabbFree,
	type HoleGrid,
	type SolidGrid,
} from "./collision";
import {isSwimTile, type TerrainGrid} from "./terrain";

const CLIFF_DIRECTION_PROPERTY = "cliffDirection";

// cliffs are walkable on most of the tile surface; only a sub-rectangle (the
// fall edge, defined per-tile via tiled's collision editor) triggers a hop.
// each region carries the direction the body should hop in, taken from the
// tile's explicit `cliffDirection` property and then rotated by the cell's flip
// flags so a flipped cliff tile drops the player off its painted edge rather
// than always in the authored direction.
export type CliffDirection = "up" | "down" | "left" | "right";

export type CliffRegion = Aabb & {readonly direction: CliffDirection};

// a region list rather than a cell lattice: cliff edges are sub-tile
// rectangles, so nothing about them is sampled per cell.
export type CliffGrid = {readonly regions: ReadonlyArray<CliffRegion>};

export function buildCliffGrid(map: TiledMap): CliffGrid {
	const tiles = collectTilesWithStringProperty(map, CLIFF_DIRECTION_PROPERTY);
	const regions: CliffRegion[] = [];
	forEachTaggedCellWithGid(map, new Set(tiles.keys()), (col, row, id, flip) => {
		const entry = tiles.get(id);
		const direction = entry && parseCliffDirection(entry.value);
		const objects = entry?.tile.objectgroup?.objects;
		if (!direction || !objects) return;
		for (const obj of objects) {
			const rect = objectAabb(obj);
			if (!rect) continue;
			const oriented = applyTileFlipToRect(rect, flip, map.tilewidth, map.tileheight);
			regions.push({
				x: col * map.tilewidth + oriented.x,
				y: row * map.tileheight + oriented.y,
				width: oriented.width,
				height: oriented.height,
				direction: applyTileFlipToDirection(direction, flip),
			});
		}
	});
	return {regions};
}

function parseCliffDirection(value: string): CliffDirection | null {
	switch (value) {
		case "up":
		case "down":
		case "left":
		case "right":
			return value;
		default:
			return null;
	}
}

// transforms a tile-local rect through tiled's flip flags. order matches the
// renderer (drawTile): diagonal first (transpose), then horizontal/vertical
// mirrors. assumes square tiles for the diagonal swap — the only sensible
// case for rotated cells.
function applyTileFlipToRect(
	rect: Aabb,
	flip: TileFlip,
	tileWidth: number,
	tileHeight: number
): Aabb {
	let {x, y, width, height} = rect;
	if (flip.diagonal) {
		[x, y] = [y, x];
		[width, height] = [height, width];
	}
	if (flip.horizontal) x = tileWidth - x - width;
	if (flip.vertical) y = tileHeight - y - height;
	return {x, y, width, height};
}

// rotates a fall direction through tiled's flip flags, in the same order as
// applyTileFlipToRect (diagonal transpose, then horizontal, then vertical) so a
// flipped cliff tile's painted edge and its hop direction stay in agreement.
// directions are carried as unit vectors through the transform: diagonal swaps
// the axes, horizontal negates x, vertical negates y.
export const CLIFF_DIRECTION_VECTORS: Record<CliffDirection, readonly [number, number]> = {
	up: [0, -1],
	down: [0, 1],
	left: [-1, 0],
	right: [1, 0],
};

function applyTileFlipToDirection(direction: CliffDirection, flip: TileFlip): CliffDirection {
	let [x, y] = CLIFF_DIRECTION_VECTORS[direction];
	if (flip.diagonal) [x, y] = [y, x];
	if (flip.horizontal) x = -x;
	if (flip.vertical) y = -y;
	if (x !== 0) return x < 0 ? "left" : "right";
	return y < 0 ? "up" : "down";
}

// returns the first cliff region the box overlaps, or null. callers use the
// region's direction to decide which way to launch a cliff hop.
export function findOverlappingCliff(box: Aabb, cliffs: CliffGrid): CliffRegion | null {
	for (const region of cliffs.regions) if (aabbsOverlap(box, region)) return region;
	return null;
}

export function aabbOverlapsCliff(box: Aabb, cliffs: CliffGrid): boolean {
	return findOverlappingCliff(box, cliffs) !== null;
}

// the grids a landing search consults. structurally a subset of WorldGrids, so
// callers pass theirs straight in — spelled out here rather than imported so
// this module stays below the grid-set module it feeds.
export type CliffLandingGrids = {
	readonly solid: SolidGrid;
	readonly terrain: TerrainGrid;
	readonly holes: HoleGrid;
	readonly cliffs: CliffGrid;
};

// scans tiles in `direction` from `box` for the first one where the footprint
// stands clear of solid, hole, and cliff. tiles between the cliff edge and the
// landing (the cliff face itself) are skipped — the body arcs over them. the
// landing snaps to the tile edge nearest the start so the hop reads as minimal
// rather than a teleport across the tile. water is landable, but a narrow
// channel bounded by a facing cliff should be cleared in one hop: the first
// water tile is kept as a fallback and the scan continues — if the run meets
// another cliff the hop carries past it, otherwise (wall, hole, map edge) the
// body drops into the water. returns null only when no landable tile exists
// before the map ends.
export function findCliffLanding(
	grids: CliffLandingGrids,
	box: Aabb,
	direction: CliffDirection
): Aabb | null {
	const {solid: grid, terrain, holes, cliffs} = grids;
	const horizontal = direction === "left" || direction === "right";
	const positive = direction === "down" || direction === "right";
	const tileSize = horizontal ? grid.tileWidth : grid.tileHeight;
	const extent = horizontal ? box.width : box.height;
	const start = horizontal ? box.x : box.y;
	const startTile = positive
		? Math.floor((start + extent - EPSILON) / tileSize) + 1
		: Math.floor(start / tileSize) - 1;
	const limit = horizontal ? grid.width : grid.height;
	const step = positive ? 1 : -1;
	let water: Aabb | null = null;
	let waterMetCliff = false;
	for (let t = startTile; t >= 0 && t < limit; t += step) {
		const coord = positive ? t * tileSize : (t + 1) * tileSize - extent;
		const candidate: Aabb = horizontal ? {...box, x: coord} : {...box, y: coord};
		if (aabbOverlapsCliff(candidate, cliffs)) {
			if (water) waterMetCliff = true;
			continue;
		}
		if (!isAabbFree(grid, candidate) || aabbOverlapsHole(holes, candidate)) {
			if (water) return water;
			continue;
		}
		if (isSwimTile(terrain, candidate)) {
			if (waterMetCliff) return candidate;
			water ??= candidate;
			continue;
		}
		return water && !waterMetCliff ? water : candidate;
	}
	return water;
}
