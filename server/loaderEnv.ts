import {DOMParser} from "@xmldom/xmldom";
import {readFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";
import type {MapLoaderEnv} from "@/tiled/loadMap";
import type {TilesetLoaderEnv, XmlElement} from "@/tiled/externalTileset";

// resolves a fs path relative to a base via file:// URLs so the same code
// works for both absolute paths and tsx `source="..."` relative references.
function resolveFsUrl(base: string, relative: string): string {
	const baseUrl = base.startsWith("file:") ? new URL(base) : pathToFileURL(base);
	return new URL(relative, baseUrl).toString();
}

async function readFsUrl(fileUrl: string): Promise<Buffer> {
	const url = fileUrl.startsWith("file:") ? new URL(fileUrl) : pathToFileURL(fileUrl);
	return readFile(url);
}

export const nodeTilesetLoaderEnv: TilesetLoaderEnv = {
	fetchText: async (url) => (await readFsUrl(url)).toString("utf-8"),
	parseXml: (xml, sourceUrl) => {
		const doc = new DOMParser().parseFromString(xml, "application/xml");
		const root = doc.documentElement;
		if (!root) throw new Error(`empty xml document at ${sourceUrl}`);
		// xmldom's Element satisfies the structural XmlElement shape that
		// externalTileset.ts parses against (children + getAttribute + nodeName).
		return root as unknown as XmlElement;
	},
	resolveUrl: resolveFsUrl,
};

export const nodeMapLoaderEnv: MapLoaderEnv = {
	fetchJson: async (url) => {
		const text = (await readFsUrl(url)).toString("utf-8");
		return JSON.parse(text);
	},
	tilesetEnv: nodeTilesetLoaderEnv,
};
