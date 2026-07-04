import type {TiledMap} from "@/tiled/loadMap";
import {forEachTaggedCellWithGid, getNumberProperty, iterateTilesetTiles} from "@/tiled/tileScan";
import type {Aabb} from "./collision";

const PUSH_X_PROPERTY = "pushX";
const PUSH_Y_PROPERTY = "pushY";

export type PushVector = {readonly x: number; readonly y: number};

const ZERO_PUSH: PushVector = {x: 0, y: 0};

// per-cell conveyor velocity in px/sec. tiles tagged with pushX / pushY (the
// animated current tiles) continuously shove any body whose footprint center
// rests on them; the two axes live in parallel arrays sampled like terrain.
export type PushGrid = {
	readonly width: number;
	readonly height: number;
	readonly tileWidth: number;
	readonly tileHeight: number;
	readonly velocityX: Float32Array;
	readonly velocityY: Float32Array;
};

export function buildPushGrid(map: TiledMap): PushGrid {
	const size = map.width * map.height;
	const velocityX = new Float32Array(size);
	const velocityY = new Float32Array(size);
	const vectors = collectPushVectors(map);
	forEachTaggedCellWithGid(map, new Set(vectors.keys()), (col, row, id) => {
		const v = vectors.get(id);
		if (!v) return;
		const i = row * map.width + col;
		velocityX[i] = v.x;
		velocityY[i] = v.y;
	});
	return {
		width: map.width,
		height: map.height,
		tileWidth: map.tilewidth,
		tileHeight: map.tileheight,
		velocityX,
		velocityY,
	};
}

// reads each tileset tile's push vector keyed by absolute gid. a missing
// component defaults to 0, and a fully-zero vector is dropped so it never
// stamps a cell. a current's push is authored only on its animated base tile,
// so the vector is mirrored onto the animation's frame tiles too — painting any
// frame of a current drifts the same way the base does. an explicit per-tile
// push always wins over one inherited from an animation.
function collectPushVectors(map: TiledMap): Map<number, PushVector> {
	const explicit = new Map<number, PushVector>();
	const inherited = new Map<number, PushVector>();
	for (const {gid, tile} of iterateTilesetTiles(map)) {
		const x = getNumberProperty(tile.properties, PUSH_X_PROPERTY) ?? 0;
		const y = getNumberProperty(tile.properties, PUSH_Y_PROPERTY) ?? 0;
		if (x === 0 && y === 0) continue;
		const v: PushVector = {x, y};
		explicit.set(gid, v);
		const firstGid = gid - tile.id;
		for (const frame of tile.animation ?? []) inherited.set(firstGid + frame.tileid, v);
	}
	return new Map([...inherited, ...explicit]);
}

// samples the push velocity under the box's footprint center, matching how
// terrain reads "standing on". off-grid or non-push cells return the zero
// vector.
export function samplePush(grid: PushGrid, box: Aabb): PushVector {
	const col = Math.floor((box.x + box.width / 2) / grid.tileWidth);
	const row = Math.floor((box.y + box.height / 2) / grid.tileHeight);
	if (col < 0 || row < 0 || col >= grid.width || row >= grid.height) return ZERO_PUSH;
	const i = row * grid.width + col;
	const x = grid.velocityX[i];
	const y = grid.velocityY[i];
	if (x === 0 && y === 0) return ZERO_PUSH;
	return {x, y};
}

export function forEachPushCell(
	grid: PushGrid,
	visit: (col: number, row: number, v: PushVector) => void
): void {
	for (let row = 0; row < grid.height; row++) {
		for (let col = 0; col < grid.width; col++) {
			const i = row * grid.width + col;
			const x = grid.velocityX[i];
			const y = grid.velocityY[i];
			if (x === 0 && y === 0) continue;
			visit(col, row, {x, y});
		}
	}
}
