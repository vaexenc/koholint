import {ITiledMap} from "@workadventure/tiled-map-type-guard";
import {expandExternalTilesets} from "./externalTileset";

export type TiledMap = ITiledMap & {
	width: number;
	height: number;
	tilewidth: number;
	tileheight: number;
};

// shared IO surface for map loading: fetchJson pulls a map or external tileset
// json, resolveUrl resolves a tileset/image reference relative to its parent.
// the env is required: browser callers pass browserMapLoaderEnv (./browserEnv),
// the server passes nodeMapLoaderEnv. keeping the platform impls out of this
// module lets it type-check under both the browser and the node server config.
export type MapLoaderEnv = {
	readonly fetchJson: (url: string) => Promise<unknown>;
	readonly resolveUrl: (base: string, relative: string) => string;
};

export class TiledMapValidationError extends Error {
	readonly issues: unknown;
	constructor(message: string, issues: unknown) {
		super(message);
		this.name = "TiledMapValidationError";
		this.issues = issues;
	}
}

export function parseTiledMap(data: unknown, source?: string): TiledMap {
	const result = ITiledMap.safeParse(data);
	if (!result.success) {
		throw new TiledMapValidationError(
			`invalid tiled map${formatSource(source)}: ${result.error.message}`,
			result.error.issues
		);
	}
	return assertRenderableMap(result.data, source);
}

export async function loadTiledMap(url: string, env: MapLoaderEnv): Promise<TiledMap> {
	const json = await env.fetchJson(url);
	const expanded = await expandExternalTilesets(json, url, env);
	return parseTiledMap(expanded, url);
}

function assertRenderableMap(map: ITiledMap, source?: string): TiledMap {
	const {width, height, tilewidth, tileheight} = map;
	if (
		width === undefined ||
		height === undefined ||
		tilewidth === undefined ||
		tileheight === undefined
	) {
		throw new TiledMapValidationError(
			`tiled map${formatSource(
				source
			)} is missing required dimensions (width, height, tilewidth, tileheight)`,
			[]
		);
	}
	return {...map, width, height, tilewidth, tileheight};
}

function formatSource(source: string | undefined): string {
	return source ? ` in ${source}` : "";
}
