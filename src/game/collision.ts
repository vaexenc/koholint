import type {TiledMap} from "@/tiled/loadMap";
import {
	collectTileIdsWithBoolProperty,
	forEachTaggedCell,
	hasBoolProperty,
	iterateObjectLayers,
} from "@/tiled/tileScan";
import type {ITiledMapObject} from "@workadventure/tiled-map-type-guard";

const SOLID_PROPERTY = "solid";

export type SolidGrid = {
	readonly width: number;
	readonly height: number;
	readonly tileWidth: number;
	readonly tileHeight: number;
	readonly cells: Uint8Array;
};

export type Aabb = {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
};

// scans every tile layer and stamps a 1 wherever the underlying tileset tile
// is tagged solid in tiled. flips don't affect collidability so we just mask
// the gid down to its raw id. multiple layers OR together, so a walkable
// surface drawn beneath a solid prop still results in a solid cell.
export function buildSolidGrid(map: TiledMap): SolidGrid {
	const solidIds = collectTileIdsWithBoolProperty(map, SOLID_PROPERTY);
	const cells = new Uint8Array(map.width * map.height);
	forEachTaggedCell(map, solidIds, (col, row) => {
		cells[row * map.width + col] = 1;
	});
	for (const layer of iterateObjectLayers(map)) {
		const layerSolid = hasBoolProperty(layer.properties, SOLID_PROPERTY);
		for (const object of layer.objects) {
			if (!layerSolid && !hasBoolProperty(object.properties, SOLID_PROPERTY)) continue;
			const box = objectAabb(object);
			if (!box) continue;
			stampSolidCells(cells, map, box);
		}
	}
	return {
		width: map.width,
		height: map.height,
		tileWidth: map.tilewidth,
		tileHeight: map.tileheight,
		cells,
	};
}

export function isCellSolid(grid: SolidGrid, col: number, row: number): boolean {
	if (col < 0 || row < 0 || col >= grid.width || row >= grid.height) return true;
	return grid.cells[row * grid.width + col] === 1;
}

// true when no solid cell overlaps the box. epsilon matches sweepAxis so a
// box flush against a tile boundary doesn't count the neighbour cell.
export function isAabbFree(grid: SolidGrid, box: Aabb): boolean {
	const minCol = Math.floor(box.x / grid.tileWidth);
	const maxCol = Math.floor((box.x + box.width - 1e-6) / grid.tileWidth);
	const minRow = Math.floor(box.y / grid.tileHeight);
	const maxRow = Math.floor((box.y + box.height - 1e-6) / grid.tileHeight);
	for (let row = minRow; row <= maxRow; row++) {
		for (let col = minCol; col <= maxCol; col++) {
			if (isCellSolid(grid, col, row)) return false;
		}
	}
	return true;
}

export type NearestFreeOptions = {
	readonly maxRadiusPx?: number;
	readonly stepPx?: number;
};

// expanding-ring search by chebyshev distance, returning the free position
// nearest the input by euclidean distance. correctness relies on the fact
// that euclidean >= chebyshev, so once the current ring radius exceeds the
// best euclidean distance found so far, no later ring can improve on it.
//
// each ring is the perimeter of a square at chebyshev radius r: full top/
// bottom rows, plus the two outer columns of intermediate rows. step lets
// callers trade precision for speed; default is 1px.
export function findNearestFreeAabb(
	grid: SolidGrid,
	box: Aabb,
	options: NearestFreeOptions = {}
): Aabb | null {
	if (isAabbFree(grid, box)) return box;
	const step = Math.max(1, Math.floor(options.stepPx ?? 1));
	const defaultRadius = Math.max(grid.tileWidth, grid.tileHeight) * 16;
	const maxRadius = Math.max(step, Math.floor(options.maxRadiusPx ?? defaultRadius));
	let bestX = box.x;
	let bestY = box.y;
	let bestDistSq = Infinity;
	for (let r = step; r <= maxRadius; r += step) {
		if (r * r > bestDistSq) break;
		for (let dy = -r; dy <= r; dy += step) {
			const fullRow = Math.abs(dy) === r;
			const dxStep = fullRow ? step : 2 * r;
			for (let dx = -r; dx <= r; dx += dxStep) {
				const distSq = dx * dx + dy * dy;
				if (distSq >= bestDistSq) continue;
				const candidate: Aabb = {
					x: box.x + dx,
					y: box.y + dy,
					width: box.width,
					height: box.height,
				};
				if (!isAabbFree(grid, candidate)) continue;
				bestDistSq = distSq;
				bestX = candidate.x;
				bestY = candidate.y;
			}
		}
	}
	if (bestDistSq === Infinity) return null;
	return {x: bestX, y: bestY, width: box.width, height: box.height};
}

// axis-separated swept move. returns the post-collision aabb position. each
// axis is resolved independently so the body slides along walls rather than
// snagging at corners. the world bounds are treated as solid via isCellSolid.
export function moveAabb(grid: SolidGrid, box: Aabb, dx: number, dy: number): Aabb {
	const afterX = sweepAxis(grid, box, dx, "x");
	const afterBoth = sweepAxis(grid, afterX, dy, "y");
	return afterBoth;
}

function sweepAxis(grid: SolidGrid, box: Aabb, delta: number, axis: "x" | "y"): Aabb {
	if (delta === 0) return box;
	const target = (axis === "x" ? box.x : box.y) + delta;
	const blocked = findBlockingEdge(grid, box, target, axis, delta > 0);
	const resolved = blocked ?? target;
	return axis === "x" ? {...box, x: resolved} : {...box, y: resolved};
}

function findBlockingEdge(
	grid: SolidGrid,
	box: Aabb,
	target: number,
	axis: "x" | "y",
	movingPositive: boolean
): number | null {
	const tileSize = axis === "x" ? grid.tileWidth : grid.tileHeight;
	const perpSize = axis === "x" ? grid.tileHeight : grid.tileWidth;
	const perpStart = axis === "x" ? box.y : box.x;
	const perpExtent = axis === "x" ? box.height : box.width;
	const perpMin = Math.floor(perpStart / perpSize);
	// `perpStart + perpExtent` is the exclusive far edge; subtract an epsilon
	// so a body exactly aligned to a tile boundary doesn't claim collisions
	// against the next row/column it isn't actually overlapping.
	const perpMax = Math.floor((perpStart + perpExtent - 1e-6) / perpSize);
	const extent = axis === "x" ? box.width : box.height;
	if (movingPositive) {
		const currentFar = (axis === "x" ? box.x : box.y) + extent;
		const targetFar = target + extent;
		const startTile = Math.floor(currentFar / tileSize);
		const endTile = Math.floor((targetFar - 1e-6) / tileSize);
		for (let t = Math.max(startTile, 0); t <= endTile; t++) {
			if (anyPerpSolid(grid, axis, t, perpMin, perpMax)) return t * tileSize - extent;
		}
	} else {
		const startTile = Math.floor((axis === "x" ? box.x : box.y) / tileSize) - 1;
		const endTile = Math.floor(target / tileSize);
		for (let t = startTile; t >= endTile; t--) {
			if (anyPerpSolid(grid, axis, t, perpMin, perpMax)) return (t + 1) * tileSize;
		}
	}
	return null;
}

function anyPerpSolid(
	grid: SolidGrid,
	axis: "x" | "y",
	tile: number,
	perpMin: number,
	perpMax: number
): boolean {
	for (let p = perpMin; p <= perpMax; p++) {
		const col = axis === "x" ? tile : p;
		const row = axis === "x" ? p : tile;
		if (isCellSolid(grid, col, row)) return true;
	}
	return false;
}

// tile-objects use tiled's bottom-origin convention (y marks the sprite's
// baseline), while all other shapes are top-origin. points and path objects
// have no usable aabb for grid stamping so they're skipped.
function objectAabb(object: ITiledMapObject): Aabb | null {
	if (object.point || object.polygon || object.polyline) return null;
	const width = object.width ?? 0;
	const height = object.height ?? 0;
	if (width <= 0 || height <= 0) return null;
	const y = object.gid !== undefined ? object.y - height : object.y;
	return {x: object.x, y, width, height};
}

function stampSolidCells(cells: Uint8Array, map: TiledMap, box: Aabb): void {
	const minCol = Math.max(0, Math.floor(box.x / map.tilewidth));
	const maxCol = Math.min(map.width - 1, Math.floor((box.x + box.width - 1e-6) / map.tilewidth));
	const minRow = Math.max(0, Math.floor(box.y / map.tileheight));
	const maxRow = Math.min(
		map.height - 1,
		Math.floor((box.y + box.height - 1e-6) / map.tileheight)
	);
	for (let row = minRow; row <= maxRow; row++) {
		for (let col = minCol; col <= maxCol; col++) {
			cells[row * map.width + col] = 1;
		}
	}
}
