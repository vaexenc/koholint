import type {TiledMap} from "@/tiled/loadMap";
import {
	collectTileIdsWithBoolProperty,
	collectTilesWithBoolProperty,
	forEachTaggedCell,
	forEachTaggedCellWithGid,
	hasBoolProperty,
	iterateObjectLayers,
} from "@/tiled/tileScan";
import type {ITiledMapObject} from "@workadventure/tiled-map-type-guard";

const SOLID_PROPERTY = "solid";
const HOLE_PROPERTY = "hole";
const CLIFF_PROPERTY = "cliff";

export type SolidGrid = {
	readonly width: number;
	readonly height: number;
	readonly tileWidth: number;
	readonly tileHeight: number;
	readonly cells: Uint8Array;
};

// holes share the SolidGrid shape but are sampled with hole-specific semantics
// (no out-of-bounds fallback, jump-over behavior in moveAabb).
export type HoleGrid = SolidGrid;

export type Aabb = {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
};

// scans every tile layer and stamps a 1 wherever the underlying tileset tile
// is tagged with the given boolean property in tiled. flips don't affect the
// property so we just mask the gid down to its raw id. multiple layers OR
// together, so a walkable surface drawn beneath a tagged prop still results
// in a tagged cell.
function buildBoolPropertyGrid(map: TiledMap, property: string): SolidGrid {
	const ids = collectTileIdsWithBoolProperty(map, property);
	const cells = new Uint8Array(map.width * map.height);
	forEachTaggedCell(map, ids, (col, row) => {
		cells[row * map.width + col] = 1;
	});
	for (const layer of iterateObjectLayers(map)) {
		const layerTagged = hasBoolProperty(layer.properties, property);
		for (const object of layer.objects) {
			if (!layerTagged && !hasBoolProperty(object.properties, property)) continue;
			const box = objectAabb(object);
			if (!box) continue;
			stampGridCells(cells, map, box);
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

export function buildSolidGrid(map: TiledMap): SolidGrid {
	return buildBoolPropertyGrid(map, SOLID_PROPERTY);
}

export function buildHoleGrid(map: TiledMap): HoleGrid {
	return buildBoolPropertyGrid(map, HOLE_PROPERTY);
}

// cliffs are walkable on most of the tile surface; only a sub-rectangle (the
// fall edge, defined per-tile via tiled's collision editor) triggers a hop.
// the grid is just a flat list of those sub-rectangles in world coordinates,
// kept alongside map dimensions for parity with the other grid types.
export type CliffGrid = {
	readonly width: number;
	readonly height: number;
	readonly tileWidth: number;
	readonly tileHeight: number;
	readonly regions: ReadonlyArray<Aabb>;
};

export function buildCliffGrid(map: TiledMap): CliffGrid {
	const tiles = collectTilesWithBoolProperty(map, CLIFF_PROPERTY);
	const regions: Aabb[] = [];
	forEachTaggedCellWithGid(map, new Set(tiles.keys()), (col, row, id) => {
		const tile = tiles.get(id);
		const objects = tile?.objectgroup?.objects;
		if (!objects) return;
		for (const obj of objects) {
			const rect = objectAabb(obj);
			if (!rect) continue;
			regions.push({
				x: col * map.tilewidth + rect.x,
				y: row * map.tileheight + rect.y,
				width: rect.width,
				height: rect.height,
			});
		}
	});
	return {
		width: map.width,
		height: map.height,
		tileWidth: map.tilewidth,
		tileHeight: map.tileheight,
		regions,
	};
}

function aabbsOverlap(a: Aabb, b: Aabb): boolean {
	return (
		a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
	);
}

export function aabbOverlapsCliff(box: Aabb, cliffs: CliffGrid): boolean {
	for (const region of cliffs.regions) if (aabbsOverlap(box, region)) return true;
	return false;
}

// scans rows below `box` for the first one where the footprint stands clear
// of solid, hole, and cliff. solid rows between the cliff edge and the
// landing (the cliff face itself) are skipped — the body arcs over them. y
// snaps to the row top so the body rests flush against the tile, mirroring
// landingPosition's hole-jump snapping. returns null only when no clear row
// exists before the map ends.
export function findCliffLanding(
	grid: SolidGrid,
	holes: HoleGrid | undefined,
	cliffs: CliffGrid,
	box: Aabb
): Aabb | null {
	const tileHeight = grid.tileHeight;
	const startRow = Math.floor((box.y + box.height - 1e-6) / tileHeight) + 1;
	for (let row = startRow; row < grid.height; row++) {
		const candidate: Aabb = {
			x: box.x,
			y: row * tileHeight,
			width: box.width,
			height: box.height,
		};
		if (!isAabbFree(grid, candidate)) continue;
		if (aabbOverlapsCliff(candidate, cliffs)) continue;
		if (holes && aabbOverlapsHole(holes, candidate)) continue;
		return candidate;
	}
	return null;
}

// bitwise-ORs two same-shape grids. used to treat holes as solid during
// placement nudges, so a character spawned on a hole gets pushed out the
// same way one spawned on a wall does.
export function unionGrids(a: SolidGrid, b: SolidGrid): SolidGrid {
	const cells = new Uint8Array(a.cells.length);
	for (let i = 0; i < cells.length; i++) cells[i] = a.cells[i] | b.cells[i];
	return {
		width: a.width,
		height: a.height,
		tileWidth: a.tileWidth,
		tileHeight: a.tileHeight,
		cells,
	};
}

export function isCellSolid(grid: SolidGrid, col: number, row: number): boolean {
	if (col < 0 || row < 0 || col >= grid.width || row >= grid.height) return true;
	return grid.cells[row * grid.width + col] === 1;
}

// out-of-bounds cells are not holes; they're already handled as solid by the
// world bounds, and treating them as holes would let a body "jump" off the map.
export function isCellHole(grid: HoleGrid, col: number, row: number): boolean {
	if (col < 0 || row < 0 || col >= grid.width || row >= grid.height) return false;
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

export type MoveResult = {
	readonly position: Aabb;
	// true when the resolved position is past a contiguous hole strip the body
	// walked into. callers use this to trigger a smooth jump animation rather
	// than letting the body teleport.
	readonly jumped: boolean;
};

export type MoveOptions = {
	// max perpendicular clip (px) considered correctable. a body deeper than
	// this against a corner blocks normally. 0 disables corner correction.
	readonly cornerSlackPx?: number;
	// max perpendicular distance the body is allowed to slide per call. lets
	// callers spread the correction across multiple frames so the slide reads
	// as motion instead of a single-frame pop. defaults to Infinity (the full
	// overlap resolves in one call).
	readonly maxCornerNudgePx?: number;
};

// axis-separated swept move. each axis is resolved independently so the body
// slides along walls rather than snagging at corners. world bounds are treated
// as solid via isCellSolid. when a hole grid is supplied, a body that would
// walk into a hole instead skips past the contiguous hole strip onto the first
// non-hole non-solid tile beyond it; if no such landing exists the hole blocks
// like a wall. cornerSlackPx (see MoveOptions) lets the sweep nudge the body
// perpendicular to its motion to unstick from a near-miss corner clip.
export function moveAabb(
	grid: SolidGrid,
	box: Aabb,
	dx: number,
	dy: number,
	holes?: HoleGrid,
	options: MoveOptions = {}
): MoveResult {
	const slack = Math.max(0, options.cornerSlackPx ?? 0);
	const maxNudge = Math.max(0, options.maxCornerNudgePx ?? Infinity);
	// corner-slide only assists axes the player isn't already steering. with
	// perp input the player's own motion either clears the corner naturally
	// (would otherwise read as a speed boost) or expresses intent to push
	// into the corner (would otherwise read as the body being shoved back
	// and running in place). slide stays active for pure-axis moves where
	// there's no natural perp progress to rely on.
	const slackX = dy === 0 ? slack : 0;
	const slackY = dx === 0 ? slack : 0;
	const afterX = sweepAxis(grid, box, dx, "x", holes, slackX, maxNudge);
	const afterBoth = sweepAxis(grid, afterX.position, dy, "y", holes, slackY, maxNudge);
	return {position: afterBoth.position, jumped: afterX.jumped || afterBoth.jumped};
}

type Axis = "x" | "y";
type Blocker = {tile: number; kind: "solid" | "hole"};
type SweepResult = {position: Aabb; jumped: boolean};

function sweepAxis(
	grid: SolidGrid,
	box: Aabb,
	delta: number,
	axis: Axis,
	holes: HoleGrid | undefined,
	slackPx: number,
	maxNudgePx: number
): SweepResult {
	if (delta === 0) return {position: box, jumped: false};
	const movingPositive = delta > 0;
	const tileSize = axis === "x" ? grid.tileWidth : grid.tileHeight;
	const extent = axis === "x" ? box.width : box.height;
	const perpSize = axis === "x" ? grid.tileHeight : grid.tileWidth;
	const perpStart = axis === "x" ? box.y : box.x;
	const perpExtent = axis === "x" ? box.height : box.width;
	const perpMin = Math.floor(perpStart / perpSize);
	// `perpStart + perpExtent` is the exclusive far edge; subtract an epsilon
	// so a body exactly aligned to a tile boundary doesn't claim collisions
	// against the next row/column it isn't actually overlapping.
	const perpMax = Math.floor((perpStart + perpExtent - 1e-6) / perpSize);
	const target = (axis === "x" ? box.x : box.y) + delta;
	const range = scanRange(box, target, axis, extent, tileSize, movingPositive);
	const blocker = findFirstBlocker(grid, holes, axis, perpMin, perpMax, range, movingPositive);
	if (blocker && slackPx > 0 && maxNudgePx > 0) {
		const nudged = tryCornerNudge(
			grid,
			holes,
			box,
			axis,
			blocker.tile,
			perpMin,
			perpMax,
			perpSize,
			slackPx,
			maxNudgePx
		);
		// recurse with slack=0 so a nudge can never trigger another nudge.
		// the recursed sweep may still find the same blocker (when the nudge
		// was partial); in that case forward motion clamps and only the perp
		// slide registers this frame — exactly the smooth-slide we want.
		if (nudged) return sweepAxis(grid, nudged, delta, axis, holes, 0, 0);
	}
	const outcome = resolveSweep(
		grid,
		holes,
		blocker,
		axis,
		perpMin,
		perpMax,
		tileSize,
		extent,
		movingPositive,
		target
	);
	const position = axis === "x" ? {...box, x: outcome.value} : {...box, y: outcome.value};
	return {position, jumped: outcome.jumped};
}

function scanRange(
	box: Aabb,
	target: number,
	axis: Axis,
	extent: number,
	tileSize: number,
	movingPositive: boolean
): {start: number; end: number} {
	if (movingPositive) {
		const currentFar = (axis === "x" ? box.x : box.y) + extent;
		const targetFar = target + extent;
		return {
			start: Math.max(Math.floor(currentFar / tileSize), 0),
			end: Math.floor((targetFar - 1e-6) / tileSize),
		};
	}
	return {
		start: Math.floor((axis === "x" ? box.x : box.y) / tileSize) - 1,
		end: Math.floor(target / tileSize),
	};
}

function findFirstBlocker(
	grid: SolidGrid,
	holes: HoleGrid | undefined,
	axis: Axis,
	perpMin: number,
	perpMax: number,
	range: {start: number; end: number},
	movingPositive: boolean
): Blocker | null {
	const step = movingPositive ? 1 : -1;
	for (let t = range.start; movingPositive ? t <= range.end : t >= range.end; t += step) {
		if (anyPerpSolid(grid, axis, t, perpMin, perpMax)) return {tile: t, kind: "solid"};
		if (holes && anyPerpHole(holes, axis, t, perpMin, perpMax)) return {tile: t, kind: "hole"};
	}
	return null;
}

// walks past a hole strip in the movement direction, returning the index of
// the first tile whose perp footprint contains neither solid nor hole. a
// solid tile encountered before any landing aborts the jump (null).
function findHoleLanding(
	grid: SolidGrid,
	holes: HoleGrid,
	axis: Axis,
	perpMin: number,
	perpMax: number,
	holeTile: number,
	movingPositive: boolean
): number | null {
	const step = movingPositive ? 1 : -1;
	const limit = axis === "x" ? grid.width : grid.height;
	for (let t = holeTile + step; t >= 0 && t < limit; t += step) {
		if (anyPerpSolid(grid, axis, t, perpMin, perpMax)) return null;
		if (!anyPerpHole(holes, axis, t, perpMin, perpMax)) return t;
	}
	return null;
}

function resolveSweep(
	grid: SolidGrid,
	holes: HoleGrid | undefined,
	blocker: Blocker | null,
	axis: Axis,
	perpMin: number,
	perpMax: number,
	tileSize: number,
	extent: number,
	movingPositive: boolean,
	target: number
): {value: number; jumped: boolean} {
	if (!blocker) return {value: target, jumped: false};
	if (blocker.kind === "solid" || !holes)
		return {value: blockedEdge(blocker.tile, tileSize, extent, movingPositive), jumped: false};
	const landing = findHoleLanding(
		grid,
		holes,
		axis,
		perpMin,
		perpMax,
		blocker.tile,
		movingPositive
	);
	if (landing === null)
		return {value: blockedEdge(blocker.tile, tileSize, extent, movingPositive), jumped: false};
	return {value: landingPosition(landing, tileSize, extent, movingPositive), jumped: true};
}

function blockedEdge(
	tile: number,
	tileSize: number,
	extent: number,
	movingPositive: boolean
): number {
	return movingPositive ? tile * tileSize - extent : (tile + 1) * tileSize;
}

// snaps the body to the edge of the landing tile closest to where the jump
// started, so a jump feels like a minimal hop rather than a teleport across
// the whole tile.
function landingPosition(
	landingTile: number,
	tileSize: number,
	extent: number,
	movingPositive: boolean
): number {
	return movingPositive ? landingTile * tileSize : (landingTile + 1) * tileSize - extent;
}

function anyPerpSolid(
	grid: SolidGrid,
	axis: Axis,
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

function anyPerpHole(
	grid: HoleGrid,
	axis: Axis,
	tile: number,
	perpMin: number,
	perpMax: number
): boolean {
	for (let p = perpMin; p <= perpMax; p++) {
		const col = axis === "x" ? tile : p;
		const row = axis === "x" ? p : tile;
		if (isCellHole(grid, col, row)) return true;
	}
	return false;
}

function cellObstructs(
	grid: SolidGrid,
	holes: HoleGrid | undefined,
	col: number,
	row: number
): boolean {
	if (isCellSolid(grid, col, row)) return true;
	return holes ? isCellHole(holes, col, row) : false;
}

// classic "corner correction": when a sweep is blocked by a tile the body
// only clips on one perpendicular side, and the clip depth is within slack,
// nudge the body perpendicular to its motion so the sweep can continue past
// the corner. only fires when the perp footprint spans exactly two cells —
// boxes overlapping more than two perp cells can't be unstuck with a small
// nudge. the nudge is capped at maxNudgePx so a deep clip resolves smoothly
// across several frames instead of popping in one. validity is checked
// against the fully-slid box (not the partially-slid one) so partial slides
// that still overlap the blocker aren't rejected; the body's perp footprint
// only contracts toward the unblocked side as it slides, so any intermediate
// position is safe whenever the final one is.
function tryCornerNudge(
	grid: SolidGrid,
	holes: HoleGrid | undefined,
	box: Aabb,
	axis: Axis,
	blockerTile: number,
	perpMin: number,
	perpMax: number,
	perpSize: number,
	slackPx: number,
	maxNudgePx: number
): Aabb | null {
	if (perpMax - perpMin !== 1) return null;
	const minCol = axis === "x" ? blockerTile : perpMin;
	const minRow = axis === "x" ? perpMin : blockerTile;
	const maxCol = axis === "x" ? blockerTile : perpMax;
	const maxRow = axis === "x" ? perpMax : blockerTile;
	const minBlocked = cellObstructs(grid, holes, minCol, minRow);
	const maxBlocked = cellObstructs(grid, holes, maxCol, maxRow);
	if (minBlocked === maxBlocked) return null;
	const perpStart = axis === "x" ? box.y : box.x;
	const perpExtent = axis === "x" ? box.height : box.width;
	const boundary = perpMax * perpSize;
	const overlap = minBlocked ? boundary - perpStart : perpStart + perpExtent - boundary;
	if (overlap <= 0 || overlap > slackPx) return null;
	const direction = minBlocked ? 1 : -1;
	const fullMagnitude = overlap + 1e-3;
	const fullShift = direction * fullMagnitude;
	const fullBox: Aabb =
		axis === "x" ? {...box, y: box.y + fullShift} : {...box, x: box.x + fullShift};
	if (!isAabbClear(grid, holes, fullBox)) return null;
	// apply only as much of the slide as fits this frame's budget. partial
	// shifts leave the body overlapping the blocker cell; the recursed sweep
	// then clamps forward motion at the wall while the perp coord advances,
	// producing a smooth multi-frame slide.
	const magnitude = Math.min(fullMagnitude, maxNudgePx);
	const shift = direction * magnitude;
	return axis === "x" ? {...box, y: box.y + shift} : {...box, x: box.x + shift};
}

// like isAabbFree but also rejects boxes overlapping a hole when a hole grid
// is supplied. used to validate the destination of a corner-correction slide
// so the body never slides off a wall into a pit or off the map.
function isAabbClear(grid: SolidGrid, holes: HoleGrid | undefined, box: Aabb): boolean {
	if (!isAabbFree(grid, box)) return false;
	return holes ? !aabbOverlapsHole(holes, box) : true;
}

function aabbOverlapsHole(holes: HoleGrid, box: Aabb): boolean {
	const minCol = Math.floor(box.x / holes.tileWidth);
	const maxCol = Math.floor((box.x + box.width - 1e-6) / holes.tileWidth);
	const minRow = Math.floor(box.y / holes.tileHeight);
	const maxRow = Math.floor((box.y + box.height - 1e-6) / holes.tileHeight);
	for (let row = minRow; row <= maxRow; row++) {
		for (let col = minCol; col <= maxCol; col++) {
			if (isCellHole(holes, col, row)) return true;
		}
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

function stampGridCells(cells: Uint8Array, map: TiledMap, box: Aabb): void {
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
