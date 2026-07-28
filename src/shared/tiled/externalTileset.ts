// converts an external Tiled JSON tileset reference (a `{source, firstgid}`
// entry in a map's tilesets array) into the same embedded shape Tiled emits
// when a tileset is inlined into the map json. downstream code (loadTilesets,
// animation table, tile property scans) then stays oblivious to whether the
// source on disk was inline or external.

import {isRecord} from "@/shared/lib/isRecord";
import type {MapLoaderEnv} from "./loadMap";

type Json = Record<string, unknown>;

export async function expandExternalTilesets(
	data: unknown,
	mapUrl: string,
	env: MapLoaderEnv
): Promise<unknown> {
	if (!isRecord(data)) return data;
	const tilesets = data.tilesets;
	if (!Array.isArray(tilesets)) return data;
	const expanded = await Promise.all(
		tilesets.map((entry) => expandIfExternal(entry, mapUrl, env))
	);
	return {...data, tilesets: expanded};
}

async function expandIfExternal(
	entry: unknown,
	mapUrl: string,
	env: MapLoaderEnv
): Promise<unknown> {
	if (!isRecord(entry)) return entry;
	const {source, firstgid} = entry;
	if (typeof source !== "string" || typeof firstgid !== "number") return entry;
	const tilesetUrl = env.resolveUrl(mapUrl, source);
	const tileset = await env.fetchJson(tilesetUrl);
	if (!isRecord(tileset)) throw new Error(`external tileset ${tilesetUrl} is not a json object`);
	return embedTileset(tileset, tilesetUrl, firstgid, env);
}

// merges firstgid into the external tileset and rewrites its image path to an
// absolute url resolved against the tileset file (which may live in a different
// directory than the map), so loadTilesets can resolve it without knowing where
// the tileset came from.
function embedTileset(
	tileset: Json,
	tilesetUrl: string,
	firstgid: number,
	env: MapLoaderEnv
): Json {
	const embedded: Json = {...tileset, firstgid};
	if (typeof tileset.image === "string")
		embedded.image = env.resolveUrl(tilesetUrl, tileset.image);
	return embedded;
}
