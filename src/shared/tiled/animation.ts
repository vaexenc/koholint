import type {TiledMap} from "./loadMap";
import {iterateTilesetTiles} from "./tileScan";

export type AnimationFrame = {
	readonly tileId: number;
	readonly durationMs: number;
};

export type TileAnimation = {
	readonly frames: readonly AnimationFrame[];
	readonly totalDurationMs: number;
};

export type AnimationTable = ReadonlyMap<number, TileAnimation>;

export function buildAnimationTable(map: TiledMap): AnimationTable {
	const table = new Map<number, TileAnimation>();
	// frames are authored as tileset-local ids, so each is rebased onto the same
	// absolute numbering the map's cells use. `gid` is already that for this tile,
	// which recovers the tileset's firstgid without a second scan.
	for (const {gid, tile} of iterateTilesetTiles(map)) {
		const animation = tile.animation;
		if (!animation || animation.length === 0) continue;
		const firstGid = gid - tile.id;
		const frames = animation.map((frame) => ({
			tileId: firstGid + frame.tileid,
			durationMs: frame.duration,
		}));
		const totalDurationMs = frames.reduce((sum, frame) => sum + frame.durationMs, 0);
		if (totalDurationMs <= 0) continue;
		table.set(gid, {frames, totalDurationMs});
	}
	return table;
}

export function resolveAnimatedTileId(
	animations: AnimationTable,
	tileId: number,
	timeMs: number
): number {
	const animation = animations.get(tileId);
	if (!animation) return tileId;
	let elapsed = timeMs % animation.totalDurationMs;
	for (const frame of animation.frames) {
		if (elapsed < frame.durationMs) return frame.tileId;
		elapsed -= frame.durationMs;
	}
	return animation.frames[animation.frames.length - 1].tileId;
}
