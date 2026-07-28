import type {MapLoaderEnv} from "@/shared/tiled/loadMap";

// browser implementation of the tiled loader IO surface (fetch +
// window.location). kept in its own module so the shared loaders stay free of
// DOM/window globals and the server's node type-check never pulls them in; the
// server supplies its own fs + node-url env in server/mapLoaderEnv.ts.

// resolves a map-relative reference (a tileset, a tileset's image) against the
// page. exported on its own for the tileset loader, which is browser-only and
// resolves image paths outside the env-threaded loader.
export function resolveBrowserUrl(base: string, relative: string): string {
	return new URL(relative, new URL(base, window.location.href)).toString();
}

export const browserMapLoaderEnv: MapLoaderEnv = {
	fetchJson: async (url) => {
		const response = await fetch(url);
		if (!response.ok)
			throw new Error(`failed to fetch ${url}: ${response.status} ${response.statusText}`);
		return response.json();
	},
	resolveUrl: resolveBrowserUrl,
};
