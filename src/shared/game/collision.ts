import type {Aabb} from "@/shared/lib/rect";
import {anyCellUnder, cellIndex, EPSILON, type CellGrid} from "./cellGrid";

// the physics core: what a body may occupy and how it moves through the tile
// lattice. deliberately free of any map-format knowledge — the grids arrive
// already built (see grids.ts) — so the same sweep runs in the browser's
// prediction and in the headless server sim without either dragging Tiled in.

export type SolidGrid = CellGrid & {readonly cells: Uint8Array};

// holes share the SolidGrid shape but are sampled with hole-specific semantics
// (no out-of-bounds fallback, jump-over behavior in moveAabb).
export type HoleGrid = SolidGrid;

export type {Aabb};

export function aabbsOverlap(a: Aabb, b: Aabb): boolean {
	return (
		a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
	);
}

// clamps an already swept-resolved move so the body doesn't end up overlapping
// one extra obstacle that isn't part of the static grid. resolves X then Y in
// the direction of travel, mirroring moveAabb's axis separation. meant for
// slow dynamic blockers (e.g. a teleporter pad the body must not re-enter); it
// isn't a full swept test, so a fast body could tunnel in a single tick.
export function clampOutOfBox(before: Aabb, after: Aabb, obstacle: Aabb): Aabb {
	let x = after.x;
	if (after.x !== before.x) {
		const probe: Aabb = {x, y: before.y, width: after.width, height: after.height};
		if (aabbsOverlap(probe, obstacle)) {
			x = after.x > before.x ? obstacle.x - after.width : obstacle.x + obstacle.width;
		}
	}
	let y = after.y;
	if (after.y !== before.y) {
		const probe: Aabb = {x, y, width: after.width, height: after.height};
		if (aabbsOverlap(probe, obstacle)) {
			y = after.y > before.y ? obstacle.y - after.height : obstacle.y + obstacle.height;
		}
	}
	return {x, y, width: after.width, height: after.height};
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

// out of bounds reads as solid: the world's edge blocks exactly like a wall.
export function isCellSolid(grid: SolidGrid, col: number, row: number): boolean {
	const index = cellIndex(grid, col, row);
	return index === null || grid.cells[index] === 1;
}

// out-of-bounds cells are not holes; they're already handled as solid by the
// world bounds, and treating them as holes would let a body "jump" off the map.
export function isCellHole(grid: HoleGrid, col: number, row: number): boolean {
	const index = cellIndex(grid, col, row);
	return index !== null && grid.cells[index] === 1;
}

// true when no solid cell overlaps the box.
export function isAabbFree(grid: SolidGrid, box: Aabb): boolean {
	return !anyCellUnder(grid, box, (col, row) => isCellSolid(grid, col, row));
}

export function aabbOverlapsHole(holes: HoleGrid, box: Aabb): boolean {
	return anyCellUnder(holes, box, (col, row) => isCellHole(holes, col, row));
}

// expanding-ring search by chebyshev distance, returning the free position
// nearest the input by euclidean distance. correctness relies on the fact
// that euclidean >= chebyshev, so once the current ring radius exceeds the
// best euclidean distance found so far, no later ring can improve on it.
//
// each ring is the perimeter of a square at chebyshev radius r: full top/
// bottom rows, plus the two outer columns of intermediate rows. searched a
// pixel at a time, out to sixteen tiles — past that a body is wedged somewhere
// no nudge will save it, and the caller leaves it where it stands.
export function findNearestFreeAabb(grid: SolidGrid, box: Aabb): Aabb | null {
	if (isAabbFree(grid, box)) return box;
	const maxRadius = Math.max(grid.tileWidth, grid.tileHeight) * 16;
	let bestX = box.x;
	let bestY = box.y;
	let bestDistSq = Infinity;
	for (let r = 1; r <= maxRadius; r++) {
		if (r * r > bestDistSq) break;
		for (let dy = -r; dy <= r; dy++) {
			// the ring's top and bottom rows are solid runs; the rows between
			// contribute only their two outer columns.
			const dxStep = Math.abs(dy) === r ? 1 : 2 * r;
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

// --- axis projection ----------------------------------------------------
// a sweep resolves one axis at a time, and the two axes are mirror images: the
// axis of travel ("along") and the one the footprint spans ("perp") just swap
// roles. these views are the single place that swap is written, so every helper
// below is axis-agnostic and none of them re-decides which axis it is on.
type AxisView = {
	readonly alongOf: (box: Aabb) => number;
	readonly alongExtentOf: (box: Aabb) => number;
	readonly alongTileSizeOf: (grid: SolidGrid) => number;
	readonly alongTileCountOf: (grid: SolidGrid) => number;
	readonly perpOf: (box: Aabb) => number;
	readonly perpExtentOf: (box: Aabb) => number;
	readonly perpTileSizeOf: (grid: SolidGrid) => number;
	readonly withAlong: (box: Aabb, value: number) => Aabb;
	readonly withPerp: (box: Aabb, value: number) => Aabb;
	// (along, perp) tile indices back to grid (col, row).
	readonly cell: (along: number, perp: number) => readonly [col: number, row: number];
};

const AXES = {
	x: {
		alongOf: (box) => box.x,
		alongExtentOf: (box) => box.width,
		alongTileSizeOf: (grid) => grid.tileWidth,
		alongTileCountOf: (grid) => grid.width,
		perpOf: (box) => box.y,
		perpExtentOf: (box) => box.height,
		perpTileSizeOf: (grid) => grid.tileHeight,
		withAlong: (box, value) => ({...box, x: value}),
		withPerp: (box, value) => ({...box, y: value}),
		cell: (along, perp) => [along, perp],
	},
	y: {
		alongOf: (box) => box.y,
		alongExtentOf: (box) => box.height,
		alongTileSizeOf: (grid) => grid.tileHeight,
		alongTileCountOf: (grid) => grid.height,
		perpOf: (box) => box.x,
		perpExtentOf: (box) => box.width,
		perpTileSizeOf: (grid) => grid.tileWidth,
		withAlong: (box, value) => ({...box, y: value}),
		withPerp: (box, value) => ({...box, x: value}),
		cell: (along, perp) => [perp, along],
	},
} as const satisfies Record<"x" | "y", AxisView>;

type Axis = keyof typeof AXES;

// everything one axis' sweep is resolved against, derived once at the top of
// sweepAxis and then passed around as a unit.
type Sweep = {
	readonly view: AxisView;
	readonly grid: SolidGrid;
	readonly holes: HoleGrid | undefined;
	readonly tileSize: number;
	readonly extent: number;
	readonly perpTileSize: number;
	// the perp row/column band the footprint overlaps, inclusive.
	readonly perpMin: number;
	readonly perpMax: number;
	readonly forward: boolean;
};

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
	const view = AXES[axis];
	const perpSize = view.perpTileSizeOf(grid);
	const perpStart = view.perpOf(box);
	const sweep: Sweep = {
		view,
		grid,
		holes,
		tileSize: view.alongTileSizeOf(grid),
		extent: view.alongExtentOf(box),
		perpTileSize: perpSize,
		perpMin: Math.floor(perpStart / perpSize),
		// `perpStart + perpExtent` is the exclusive far edge; subtract an epsilon
		// so a body exactly aligned to a tile boundary doesn't claim collisions
		// against the next row/column it isn't actually overlapping.
		perpMax: Math.floor((perpStart + view.perpExtentOf(box) - EPSILON) / perpSize),
		forward: delta > 0,
	};
	const target = view.alongOf(box) + delta;
	const blocker = findFirstBlocker(sweep, scanRange(sweep, box, target));
	if (blocker && slackPx > 0 && maxNudgePx > 0) {
		const nudged = tryCornerNudge(sweep, box, blocker.tile, slackPx, maxNudgePx);
		// recurse with slack=0 so a nudge can never trigger another nudge.
		// the recursed sweep may still find the same blocker (when the nudge
		// was partial); in that case forward motion clamps and only the perp
		// slide registers this frame — exactly the smooth-slide we want.
		if (nudged) return sweepAxis(grid, nudged, delta, axis, holes, 0, 0);
	}
	const outcome = resolveSweep(sweep, blocker, target);
	return {position: view.withAlong(box, outcome.value), jumped: outcome.jumped};
}

// the inclusive band of along-tiles the move passes through, from the leading
// edge's current tile to the one it ends in.
function scanRange(sweep: Sweep, box: Aabb, target: number): {start: number; end: number} {
	const {view, tileSize, extent, forward} = sweep;
	if (forward) {
		return {
			start: Math.max(Math.floor((view.alongOf(box) + extent) / tileSize), 0),
			end: Math.floor((target + extent - EPSILON) / tileSize),
		};
	}
	return {
		start: Math.floor(view.alongOf(box) / tileSize) - 1,
		end: Math.floor(target / tileSize),
	};
}

function findFirstBlocker(sweep: Sweep, range: {start: number; end: number}): Blocker | null {
	const step = sweep.forward ? 1 : -1;
	for (let t = range.start; sweep.forward ? t <= range.end : t >= range.end; t += step) {
		if (perpHasSolid(sweep, t)) return {tile: t, kind: "solid"};
		if (perpHasHole(sweep, t)) return {tile: t, kind: "hole"};
	}
	return null;
}

// walks past a hole strip in the movement direction, returning the index of
// the first tile whose perp footprint contains neither solid nor hole. a
// solid tile encountered before any landing aborts the jump (null).
function findHoleLanding(sweep: Sweep, holeTile: number): number | null {
	const step = sweep.forward ? 1 : -1;
	const limit = sweep.view.alongTileCountOf(sweep.grid);
	for (let t = holeTile + step; t >= 0 && t < limit; t += step) {
		if (perpHasSolid(sweep, t)) return null;
		if (!perpHasHole(sweep, t)) return t;
	}
	return null;
}

function resolveSweep(
	sweep: Sweep,
	blocker: Blocker | null,
	target: number
): {value: number; jumped: boolean} {
	if (!blocker) return {value: target, jumped: false};
	if (blocker.kind === "solid" || !sweep.holes)
		return {value: blockedEdge(sweep, blocker.tile), jumped: false};
	const landing = findHoleLanding(sweep, blocker.tile);
	if (landing === null) return {value: blockedEdge(sweep, blocker.tile), jumped: false};
	return {value: landingPosition(sweep, landing), jumped: true};
}

function blockedEdge(sweep: Sweep, tile: number): number {
	const {tileSize, extent, forward} = sweep;
	return forward ? tile * tileSize - extent : (tile + 1) * tileSize;
}

// snaps the body to the edge of the landing tile closest to where the jump
// started, so a jump feels like a minimal hop rather than a teleport across
// the whole tile.
function landingPosition(sweep: Sweep, landingTile: number): number {
	const {tileSize, extent, forward} = sweep;
	return forward ? landingTile * tileSize : (landingTile + 1) * tileSize - extent;
}

// whether any cell in the footprint's perp band at `tile` satisfies `hit`.
function perpHas(sweep: Sweep, tile: number, hit: (col: number, row: number) => boolean): boolean {
	for (let perp = sweep.perpMin; perp <= sweep.perpMax; perp++) {
		const [col, row] = sweep.view.cell(tile, perp);
		if (hit(col, row)) return true;
	}
	return false;
}

function perpHasSolid(sweep: Sweep, tile: number): boolean {
	return perpHas(sweep, tile, (col, row) => isCellSolid(sweep.grid, col, row));
}

function perpHasHole(sweep: Sweep, tile: number): boolean {
	const holes = sweep.holes;
	if (!holes) return false;
	return perpHas(sweep, tile, (col, row) => isCellHole(holes, col, row));
}

function cellObstructs(sweep: Sweep, col: number, row: number): boolean {
	if (isCellSolid(sweep.grid, col, row)) return true;
	return sweep.holes ? isCellHole(sweep.holes, col, row) : false;
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
	sweep: Sweep,
	box: Aabb,
	blockerTile: number,
	slackPx: number,
	maxNudgePx: number
): Aabb | null {
	const {view, perpMin, perpMax, perpTileSize} = sweep;
	if (perpMax - perpMin !== 1) return null;
	const [minCol, minRow] = view.cell(blockerTile, perpMin);
	const [maxCol, maxRow] = view.cell(blockerTile, perpMax);
	const minBlocked = cellObstructs(sweep, minCol, minRow);
	const maxBlocked = cellObstructs(sweep, maxCol, maxRow);
	if (minBlocked === maxBlocked) return null;
	const perpStart = view.perpOf(box);
	const boundary = perpMax * perpTileSize;
	const overlap = minBlocked
		? boundary - perpStart
		: perpStart + view.perpExtentOf(box) - boundary;
	if (overlap <= 0 || overlap > slackPx) return null;
	const direction = minBlocked ? 1 : -1;
	const fullMagnitude = overlap + 1e-3;
	if (!isAabbClear(sweep, view.withPerp(box, perpStart + direction * fullMagnitude))) return null;
	// apply only as much of the slide as fits this frame's budget. partial
	// shifts leave the body overlapping the blocker cell; the recursed sweep
	// then clamps forward motion at the wall while the perp coord advances,
	// producing a smooth multi-frame slide.
	const magnitude = Math.min(fullMagnitude, maxNudgePx);
	return view.withPerp(box, perpStart + direction * magnitude);
}

// like isAabbFree but also rejects boxes overlapping a hole when a hole grid
// is supplied. used to validate the destination of a corner-correction slide
// so the body never slides off a wall into a pit or off the map.
function isAabbClear(sweep: Sweep, box: Aabb): boolean {
	if (!isAabbFree(sweep.grid, box)) return false;
	return sweep.holes ? !aabbOverlapsHole(sweep.holes, box) : true;
}
