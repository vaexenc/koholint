import type {MapLoaderEnv} from "./loadMap";

// browser implementation of the tiled loader IO surface (fetch +
// window.location). kept in its own module so the shared loaders stay free of
// DOM/window globals and the server's node type-check never pulls them in; the
// server supplies its own fs + node-url env instead.
export const browserMapLoaderEnv: MapLoaderEnv = {
	fetchJson: async (url) => {
		const response = await fetch(url);
		if (!response.ok)
			throw new Error(`failed to fetch ${url}: ${response.status} ${response.statusText}`);
		return response.json();
	},
	resolveUrl: (base, relative) =>
		new URL(relative, new URL(base, window.location.href)).toString(),
};
