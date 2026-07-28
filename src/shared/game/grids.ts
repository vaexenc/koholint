import type {Aabb} from "@/shared/lib/rect";
import type {TiledMap} from "@/shared/tiled/loadMap";
import {
	collectTileIdsWithBoolProperty,
	forEachTaggedCellWithGid,
	hasBoolProperty,
	iterateObjectLayers,
	objectAabb,
} from "@/shared/tiled/tileScan";
import {cellGridOf, cellRange, type CellGrid} from "./cellGrid";
import {buildCliffGrid, type CliffGrid} from "./cliffs";
import type {HoleGrid, SolidGrid} from "./collision";
import {buildPushGrid, type PushGrid} from "./push";
import {buildTeleporterGrid, type TeleporterGrid} from "./teleport";
import {buildTerrainGrid, type TerrainGrid} from "./terrain";

// everything the simulation collides, samples or triggers against, in one value.
// every grid is present: a map with no cliffs yields an empty cliff grid, which
// answers every query exactly as an absent one would, so the simulation needs no
// "does this world have X" branch anywhere. this is the single declaration of the
// set — World holds one, stepCharacter takes one, and adding a grid is one edit
// here plus its use.
export type WorldGrids = {
	readonly solid: SolidGrid;
	readonly terrain: TerrainGrid;
	readonly holes: HoleGrid;
	readonly cliffs: CliffGrid;
	readonly teleporters: TeleporterGrid;
	readonly push: PushGrid;
};

const SOLID_PROPERTY = "solid";
const HOLE_PROPERTY = "hole";

// the one place a map is turned into a simulation. both ends call it, so client
// prediction and the authoritative server can't disagree on how the map was read.
export function buildWorldGrids(map: TiledMap): WorldGrids {
	return {
		solid: buildBoolPropertyGrid(map, SOLID_PROPERTY),
		terrain: buildTerrainGrid(map),
		holes: buildBoolPropertyGrid(map, HOLE_PROPERTY),
		cliffs: buildCliffGrid(map),
		teleporters: buildTeleporterGrid(map),
		push: buildPushGrid(map),
	};
}

// scans every tile layer and stamps a 1 wherever the underlying tileset tile
// is tagged with the given boolean property in tiled. flips don't affect the
// property so we just mask the gid down to its raw id. multiple layers OR
// together, so a walkable surface drawn beneath a tagged prop still results
// in a tagged cell. object layers contribute too: a tagged object (or every
// object on a tagged layer) stamps the cells its box covers.
function buildBoolPropertyGrid(map: TiledMap, property: string): SolidGrid {
	const grid = cellGridOf(map);
	const ids = collectTileIdsWithBoolProperty(map, property);
	const cells = new Uint8Array(grid.width * grid.height);
	forEachTaggedCellWithGid(map, ids, (col, row) => {
		cells[row * grid.width + col] = 1;
	});
	for (const layer of iterateObjectLayers(map)) {
		const layerTagged = hasBoolProperty(layer.properties, property);
		for (const object of layer.objects) {
			if (!layerTagged && !hasBoolProperty(object.properties, property)) continue;
			const box = objectAabb(object);
			if (box) stampCells(cells, grid, box);
		}
	}
	return {...grid, cells};
}

function stampCells(cells: Uint8Array, grid: CellGrid, box: Aabb): void {
	// same cells a sampler would read, clipped to the map — an object may hang
	// over the edge, and those cells have no slot to stamp.
	const range = cellRange(grid, box);
	const minCol = Math.max(0, range.minCol);
	const maxCol = Math.min(grid.width - 1, range.maxCol);
	const minRow = Math.max(0, range.minRow);
	const maxRow = Math.min(grid.height - 1, range.maxRow);
	for (let row = minRow; row <= maxRow; row++) {
		for (let col = minCol; col <= maxCol; col++) cells[row * grid.width + col] = 1;
	}
}
