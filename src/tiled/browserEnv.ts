import type {TilesetLoaderEnv} from "./externalTileset";
import type {MapLoaderEnv} from "./loadMap";

// browser implementations of the tiled loader IO surface (fetch + DOMParser +
// window.location). kept in their own module so the shared loaders stay
// DOM-free and the server's node type-check never pulls these globals in; the
// server supplies its own fs + xmldom env instead.
export const browserTilesetLoaderEnv: TilesetLoaderEnv = {
	fetchText: async (url) => {
		const response = await fetch(url);
		if (!response.ok)
			throw new Error(`failed to fetch ${url}: ${response.status} ${response.statusText}`);
		return response.text();
	},
	parseXml: (xml, sourceUrl) => {
		const doc = new DOMParser().parseFromString(xml, "application/xml");
		if (doc.getElementsByTagName("parsererror").length > 0)
			throw new Error(`failed to parse tileset xml at ${sourceUrl}`);
		const root = doc.documentElement;
		if (!root) throw new Error(`empty xml document at ${sourceUrl}`);
		return root;
	},
	resolveUrl: (base, relative) =>
		new URL(relative, new URL(base, window.location.href)).toString(),
};

export const browserMapLoaderEnv: MapLoaderEnv = {
	fetchJson: async (url) => {
		const response = await fetch(url);
		if (!response.ok)
			throw new Error(
				`failed to fetch tiled map ${url}: ${response.status} ${response.statusText}`
			);
		return response.json();
	},
	tilesetEnv: browserTilesetLoaderEnv,
};
