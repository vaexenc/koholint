import {loadImage} from "@/client/lib/imageCache";
import type {TiledMap} from "@/shared/tiled/loadMap";
import {resolveBrowserUrl} from "./browserEnv";

type TilesetEntry = TiledMap["tilesets"][number];
type EmbeddedTileset = Extract<TilesetEntry, {image: string}>;

export type LoadedTileset = {
	readonly name: string;
	readonly firstGid: number;
	readonly tileWidth: number;
	readonly tileHeight: number;
	readonly columns: number;
	readonly margin: number;
	readonly spacing: number;
	readonly image: HTMLImageElement;
};

export type TileImageRect = {
	readonly image: HTMLImageElement;
	readonly sx: number;
	readonly sy: number;
	readonly sw: number;
	readonly sh: number;
};

export async function loadTilesets(map: TiledMap, mapUrl: string): Promise<LoadedTileset[]> {
	const embedded = map.tilesets.filter(isEmbeddedTileset);
	return Promise.all(embedded.map((tileset) => loadTileset(tileset, mapUrl)));
}

export function findTileImageRect(
	tilesets: readonly LoadedTileset[],
	tileId: number
): TileImageRect | null {
	const tileset = findTilesetForTileId(tilesets, tileId);
	if (!tileset) return null;
	const localId = tileId - tileset.firstGid;
	const col = localId % tileset.columns;
	const row = Math.floor(localId / tileset.columns);
	return {
		image: tileset.image,
		sx: tileset.margin + col * (tileset.tileWidth + tileset.spacing),
		sy: tileset.margin + row * (tileset.tileHeight + tileset.spacing),
		sw: tileset.tileWidth,
		sh: tileset.tileHeight,
	};
}

function isEmbeddedTileset(tileset: TilesetEntry): tileset is EmbeddedTileset {
	return "image" in tileset && typeof tileset.image === "string";
}

async function loadTileset(tileset: EmbeddedTileset, mapUrl: string): Promise<LoadedTileset> {
	const required = requireTilesetFields(tileset);
	const image = await loadImage(resolveBrowserUrl(mapUrl, tileset.image));
	return {
		name: tileset.name,
		firstGid: required.firstGid,
		tileWidth: required.tileWidth,
		tileHeight: required.tileHeight,
		columns: required.columns,
		margin: tileset.margin ?? 0,
		spacing: tileset.spacing ?? 0,
		image,
	};
}

function requireTilesetFields(tileset: EmbeddedTileset): {
	firstGid: number;
	tileWidth: number;
	tileHeight: number;
	columns: number;
} {
	const {firstgid, tilewidth, tileheight, columns, name} = tileset;
	if (
		firstgid === undefined ||
		tilewidth === undefined ||
		tileheight === undefined ||
		columns === undefined
	) {
		throw new Error(
			`tileset "${name}" is missing required fields (firstgid, tilewidth, tileheight, columns)`
		);
	}
	return {
		firstGid: firstgid,
		tileWidth: tilewidth,
		tileHeight: tileheight,
		columns,
	};
}

function findTilesetForTileId(
	tilesets: readonly LoadedTileset[],
	tileId: number
): LoadedTileset | null {
	let best: LoadedTileset | null = null;
	for (const tileset of tilesets) {
		if (tileset.firstGid <= tileId && (best === null || tileset.firstGid > best.firstGid)) {
			best = tileset;
		}
	}
	return best;
}
