import {isRecord} from "@/lib/isRecord";
import type {ITiledMap} from "@workadventure/tiled-map-type-guard";
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
// validateSchema is the optional full Tiled schema check — only the server wires
// one up, see nodeMapLoaderEnv.
export type MapLoaderEnv = {
	readonly fetchJson: (url: string) => Promise<unknown>;
	readonly resolveUrl: (base: string, relative: string) => string;
	readonly validateSchema?: (data: unknown, source: string) => void;
};

export class TiledMapValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TiledMapValidationError";
	}
}

export async function loadTiledMap(url: string, env: MapLoaderEnv): Promise<TiledMap> {
	const json = await env.fetchJson(url);
	const expanded = await expandExternalTilesets(json, url, env);
	env.validateSchema?.(expanded, url);
	if (!isRenderableMap(expanded))
		throw new TiledMapValidationError(
			`invalid tiled map in ${url}: expected an object with numeric width, height, tilewidth and tileheight plus layers and tilesets arrays`
		);
	return expanded;
}

// the renderer and the tileset loader dereference these unconditionally.
// everything nested below them is already guarded where it is used (layer kind,
// tile data, tileset fields), so this is the whole invariant the loader owns —
// which is why the browser can skip the full schema and still fail loudly on a
// map that can't be drawn.
function isRenderableMap(value: unknown): value is TiledMap {
	if (!isRecord(value)) return false;
	return (
		Array.isArray(value.layers) &&
		Array.isArray(value.tilesets) &&
		typeof value.width === "number" &&
		typeof value.height === "number" &&
		typeof value.tilewidth === "number" &&
		typeof value.tileheight === "number"
	);
}
