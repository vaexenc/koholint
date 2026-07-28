import {TiledMapValidationError, type MapLoaderEnv} from "@/shared/tiled/loadMap";
import {ITiledMap} from "@workadventure/tiled-map-type-guard";
import {readFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";

// node implementation of the tiled loader IO surface (fs + node:url). the other
// half is @/client/tiled/browserEnv; they can't sit together, since neither
// tree is type-checked with both node and DOM types — which is the point.

// resolves a fs path relative to a base via file:// URLs so the same code works
// for both absolute paths and relative `source="..."` references.
function resolveFsUrl(base: string, relative: string): string {
	const baseUrl = base.startsWith("file:") ? new URL(base) : pathToFileURL(base);
	return new URL(relative, baseUrl).toString();
}

async function readFsUrl(fileUrl: string): Promise<string> {
	const url = fileUrl.startsWith("file:") ? new URL(fileUrl) : pathToFileURL(fileUrl);
	return (await readFile(url)).toString("utf-8");
}

export const nodeMapLoaderEnv: MapLoaderEnv = {
	fetchJson: async (url) => JSON.parse(await readFsUrl(url)),
	resolveUrl: resolveFsUrl,
	// the full Tiled schema check lives here rather than in the shared loader
	// because the validator carries ~79 kB of zod, which would ship to every
	// browser for maps we author ourselves. the server loads the same map at
	// boot, so a malformed one still fails loudly before anyone can connect.
	validateSchema: (data, source) => {
		const result = ITiledMap.safeParse(data);
		if (!result.success)
			throw new TiledMapValidationError(
				`invalid tiled map in ${source}: ${result.error.message}`
			);
	},
};
