import type {TiledMap} from "./loadMap";

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
	for (const tileset of map.tilesets) {
		if (!("firstgid" in tileset) || tileset.firstgid === undefined) continue;
		const tiles = "tiles" in tileset ? tileset.tiles : undefined;
		if (!tiles) continue;
		const firstGid = tileset.firstgid;
		for (const tile of tiles) {
			const animation = tile.animation;
			if (!animation || animation.length === 0) continue;
			const frames = animation.map((frame) => ({
				tileId: firstGid + frame.tileid,
				durationMs: frame.duration,
			}));
			const totalDurationMs = frames.reduce((sum, frame) => sum + frame.durationMs, 0);
			if (totalDurationMs <= 0) continue;
			table.set(firstGid + tile.id, {frames, totalDurationMs});
		}
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
