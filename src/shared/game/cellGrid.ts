import type {Aabb} from "@/shared/lib/rect";

// every per-cell grid the simulation samples — solids, holes, terrain flags,
// conveyor velocities — is the same tile lattice over the map with a different
// payload. this is that lattice, plus the three things every sampler does with
// it: bound a cell, find the cell under a body, and walk the cells a box covers.
// keeping them here is what stops each grid from re-deriving its own copy (and
// letting the copies disagree about where a cell ends).

export type CellGrid = {
	readonly width: number;
	readonly height: number;
	readonly tileWidth: number;
	readonly tileHeight: number;
};

// the lattice a tiled map lays down. the map's dimensions are taken
// structurally so this module needs no map-format import — it sits below every
// grid built on top of it.
export function cellGridOf(map: {
	readonly width: number;
	readonly height: number;
	readonly tilewidth: number;
	readonly tileheight: number;
}): CellGrid {
	return {
		width: map.width,
		height: map.height,
		tileWidth: map.tilewidth,
		tileHeight: map.tileheight,
	};
}

// a box's far edge is exclusive, so every sampler backs off by this much before
// flooring it — otherwise a body flush against a tile boundary claims a
// collision with the neighbouring cell it isn't actually overlapping. one
// constant so the sweep and the whole-box tests can't disagree.
export const EPSILON = 1e-6;

// flat index of (col, row), or null when it falls outside the grid. what
// out-of-bounds *means* differs per grid — solid off the map blocks, a hole off
// the map doesn't — so that policy stays at the call site instead of being
// re-decided inside four near-identical bounds checks.
export function cellIndex(grid: CellGrid, col: number, row: number): number | null {
	if (col < 0 || row < 0 || col >= grid.width || row >= grid.height) return null;
	return row * grid.width + col;
}

// the cell under a box's footprint center — what "standing on" means for every
// per-tile effect (terrain speed, swim, conveyor push). the centered sample is
// deliberate: reading the box's edges would flip a body to swimming the moment
// a single pixel-row of its feet crossed water.
export function centerCell(grid: CellGrid, box: Aabb): number | null {
	return cellIndex(
		grid,
		Math.floor((box.x + box.width / 2) / grid.tileWidth),
		Math.floor((box.y + box.height / 2) / grid.tileHeight)
	);
}

export type CellRange = {
	readonly minCol: number;
	readonly maxCol: number;
	readonly minRow: number;
	readonly maxRow: number;
};

// the inclusive block of cells a box covers, unclipped — the one place the
// pixels-to-cells conversion for a whole box lives, so a sampler and a stamper
// can't disagree about which cells a box is on (they only differ in what they
// do with them).
export function cellRange(grid: CellGrid, box: Aabb): CellRange {
	return {
		minCol: Math.floor(box.x / grid.tileWidth),
		maxCol: Math.floor((box.x + box.width - EPSILON) / grid.tileWidth),
		minRow: Math.floor(box.y / grid.tileHeight),
		maxRow: Math.floor((box.y + box.height - EPSILON) / grid.tileHeight),
	};
}

// walks the cells the box covers until `hit` accepts one.
export function anyCellUnder(
	grid: CellGrid,
	box: Aabb,
	hit: (col: number, row: number) => boolean
): boolean {
	const {minCol, maxCol, minRow, maxRow} = cellRange(grid, box);
	for (let row = minRow; row <= maxRow; row++) {
		for (let col = minCol; col <= maxCol; col++) {
			if (hit(col, row)) return true;
		}
	}
	return false;
}

// walks every cell of the grid in row-major order, handing over both the
// coordinates and the flat index so payload lookups need no second conversion.
export function forEachCell(
	grid: CellGrid,
	visit: (col: number, row: number, index: number) => void
): void {
	let index = 0;
	for (let row = 0; row < grid.height; row++) {
		for (let col = 0; col < grid.width; col++) visit(col, row, index++);
	}
}
