import type {Aabb} from "@/shared/lib/rect";
import type {TiledMap} from "@/shared/tiled/loadMap";
import {collectTileIdsWithBoolProperty, forEachTaggedCellWithGid} from "@/shared/tiled/tileScan";
import {cellGridOf, centerCell, forEachCell, type CellGrid} from "./cellGrid";

// per-cell bitmask describing locomotion-affecting properties of the tile.
// new flags can be OR'd in without disturbing existing ones.
const TERRAIN_FLAG_STAIRS = 1 << 0;
const TERRAIN_FLAG_SWIM = 1 << 1;

// speed multiplier applied while the character's footprint center sits on a
// stairs tile.
const STAIRS_SPEED_MULTIPLIER = 0.5;

const STAIRS_PROPERTY = "stairs";
const SWIM_PROPERTY = "swim";

export type TerrainGrid = CellGrid & {readonly cells: Uint8Array};

// mirrors the solid grid: scans tilesets for tiles tagged with locomotion
// properties and stamps a flag bit on every cell that references such a tile.
// layers OR together so a stairs tile drawn under a decoration still slows
// the player.
export function buildTerrainGrid(map: TiledMap): TerrainGrid {
	const cells = new Uint8Array(map.width * map.height);
	const stamp = (property: string, flag: number) => {
		forEachTaggedCellWithGid(map, collectTileIdsWithBoolProperty(map, property), (col, row) => {
			cells[row * map.width + col] |= flag;
		});
	};
	stamp(STAIRS_PROPERTY, TERRAIN_FLAG_STAIRS);
	stamp(SWIM_PROPERTY, TERRAIN_FLAG_SWIM);
	return {...cellGridOf(map), cells};
}

// flags of the tile under the box's footprint center — how a player reads
// "standing on". off-grid carries no terrain.
function flagsUnder(grid: TerrainGrid, box: Aabb): number {
	const index = centerCell(grid, box);
	return index === null ? 0 : grid.cells[index];
}

export function getTerrainSpeedMultiplier(grid: TerrainGrid, box: Aabb): number {
	return (flagsUnder(grid, box) & TERRAIN_FLAG_STAIRS) !== 0 ? STAIRS_SPEED_MULTIPLIER : 1;
}

export function isSwimTile(grid: TerrainGrid, box: Aabb): boolean {
	return (flagsUnder(grid, box) & TERRAIN_FLAG_SWIM) !== 0;
}

export function forEachSwimCell(
	grid: TerrainGrid,
	visit: (col: number, row: number) => void
): void {
	forEachFlaggedCell(grid, TERRAIN_FLAG_SWIM, visit);
}

export function forEachStairsCell(
	grid: TerrainGrid,
	visit: (col: number, row: number) => void
): void {
	forEachFlaggedCell(grid, TERRAIN_FLAG_STAIRS, visit);
}

function forEachFlaggedCell(
	grid: TerrainGrid,
	flag: number,
	visit: (col: number, row: number) => void
): void {
	forEachCell(grid, (col, row, index) => {
		if ((grid.cells[index] & flag) !== 0) visit(col, row);
	});
}
