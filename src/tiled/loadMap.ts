import {ITiledMap} from "@workadventure/tiled-map-type-guard";

export type TiledMap = ITiledMap & {
	width: number;
	height: number;
	tilewidth: number;
	tileheight: number;
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

export async function loadTiledMap(url: string): Promise<TiledMap> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(
			`failed to fetch tiled map ${url}: ${response.status} ${response.statusText}`
		);
	}
	const json: unknown = await response.json();
	return parseTiledMap(json, url);
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
