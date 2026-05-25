import type {TiledMap} from "@/tiled/loadMap";
import {collectTileIdsWithBoolProperty, forEachTaggedCell} from "@/tiled/tileScan";
import type {Aabb} from "./collision";

// per-cell bitmask describing locomotion-affecting properties of the tile.
// new flags can be OR'd in without disturbing existing ones.
const TERRAIN_FLAG_STAIRS = 1 << 0;
const TERRAIN_FLAG_SWIM = 1 << 1;

// speed multiplier applied while the character's footprint center sits on a
// stairs tile.
const STAIRS_SPEED_MULTIPLIER = 0.5;

const STAIRS_PROPERTY = "stairs";
const SWIM_PROPERTY = "swim";

export type TerrainGrid = {
	readonly width: number;
	readonly height: number;
	readonly tileWidth: number;
	readonly tileHeight: number;
	readonly cells: Uint8Array;
};

// mirrors buildSolidGrid: scans tilesets for tiles tagged with locomotion
// properties and stamps a flag bit on every cell that references such a tile.
// layers OR together so a stairs tile drawn under a decoration still slows
// the player.
export function buildTerrainGrid(map: TiledMap): TerrainGrid {
	const cells = new Uint8Array(map.width * map.height);
	const stairsIds = collectTileIdsWithBoolProperty(map, STAIRS_PROPERTY);
	forEachTaggedCell(map, stairsIds, (col, row) => {
		cells[row * map.width + col] |= TERRAIN_FLAG_STAIRS;
	});
	const swimIds = collectTileIdsWithBoolProperty(map, SWIM_PROPERTY);
	forEachTaggedCell(map, swimIds, (col, row) => {
		cells[row * map.width + col] |= TERRAIN_FLAG_SWIM;
	});
	return {
		width: map.width,
		height: map.height,
		tileWidth: map.tilewidth,
		tileHeight: map.tileheight,
		cells,
	};
}

function getCellFlags(grid: TerrainGrid, col: number, row: number): number {
	if (col < 0 || row < 0 || col >= grid.width || row >= grid.height) return 0;
	return grid.cells[row * grid.width + col];
}

// samples the tile under the box's center. centered sample matches how a
// player reads "standing on" — the footprint midpoint, not the edges.
export function getTerrainSpeedMultiplier(grid: TerrainGrid, box: Aabb): number {
	const col = Math.floor((box.x + box.width / 2) / grid.tileWidth);
	const row = Math.floor((box.y + box.height / 2) / grid.tileHeight);
	const flags = getCellFlags(grid, col, row);
	if ((flags & TERRAIN_FLAG_STAIRS) !== 0) return STAIRS_SPEED_MULTIPLIER;
	return 1;
}

// samples the tile under the footprint's center, matching how
// getTerrainSpeedMultiplier reads "standing on": the bottom-center sample
// flips to swim the moment a single pixel-row of the feet box crosses a
// water tile, which reads as the character swimming on dry land while
// straddling the bank.
export function isSwimTile(grid: TerrainGrid, box: Aabb): boolean {
	const col = Math.floor((box.x + box.width / 2) / grid.tileWidth);
	const row = Math.floor((box.y + box.height / 2) / grid.tileHeight);
	return (getCellFlags(grid, col, row) & TERRAIN_FLAG_SWIM) !== 0;
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
	for (let row = 0; row < grid.height; row++) {
		for (let col = 0; col < grid.width; col++) {
			if ((grid.cells[row * grid.width + col] & flag) === 0) continue;
			visit(col, row);
		}
	}
}
