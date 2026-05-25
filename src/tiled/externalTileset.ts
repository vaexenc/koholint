// converts an external Tiled .tsx (XML) tileset reference into the same
// embedded shape Tiled emits when a tileset is inlined into the map json.
// downstream code (loadTilesets, animation table, tile property scans) can
// then stay oblivious to whether the source on disk was inline or external.

type Json = Record<string, unknown>;

export async function expandExternalTilesets(data: unknown, mapUrl: string): Promise<unknown> {
	if (!isObject(data)) return data;
	const tilesets = data.tilesets;
	if (!Array.isArray(tilesets)) return data;
	const expanded = await Promise.all(tilesets.map((entry) => expandIfExternal(entry, mapUrl)));
	return {...data, tilesets: expanded};
}

async function expandIfExternal(entry: unknown, mapUrl: string): Promise<unknown> {
	if (!isObject(entry)) return entry;
	const {source, firstgid} = entry;
	if (typeof source !== "string" || typeof firstgid !== "number") return entry;
	const tsxUrl = resolveUrl(mapUrl, source);
	const response = await fetch(tsxUrl);
	if (!response.ok) {
		throw new Error(
			`failed to fetch tileset ${tsxUrl}: ${response.status} ${response.statusText}`
		);
	}
	const xml = await response.text();
	return parseTsxTileset(xml, tsxUrl, firstgid);
}

function parseTsxTileset(xml: string, tsxUrl: string, firstgid: number): Json {
	const doc = new DOMParser().parseFromString(xml, "application/xml");
	if (doc.getElementsByTagName("parsererror").length > 0) {
		throw new Error(`failed to parse tileset xml at ${tsxUrl}`);
	}
	const root = doc.documentElement;
	if (!root || root.nodeName !== "tileset") {
		throw new Error(`unexpected root element in tileset ${tsxUrl}`);
	}
	const tileset: Json = {firstgid};
	copyStringAttr(root, "name", tileset, "name");
	copyNumberAttr(root, "tilewidth", tileset, "tilewidth");
	copyNumberAttr(root, "tileheight", tileset, "tileheight");
	copyNumberAttr(root, "spacing", tileset, "spacing");
	copyNumberAttr(root, "margin", tileset, "margin");
	copyNumberAttr(root, "tilecount", tileset, "tilecount");
	copyNumberAttr(root, "columns", tileset, "columns");
	const image = firstChild(root, "image");
	if (image) {
		const imageSource = image.getAttribute("source");
		if (typeof imageSource === "string") tileset.image = resolveUrl(tsxUrl, imageSource);
		copyNumberAttr(image, "width", tileset, "imagewidth");
		copyNumberAttr(image, "height", tileset, "imageheight");
	}
	const tiles = childrenByTag(root, "tile").map(parseTile);
	if (tiles.length > 0) tileset.tiles = tiles;
	return tileset;
}

function parseTile(el: Element): Json {
	const idAttr = el.getAttribute("id");
	const id = idAttr === null ? Number.NaN : Number(idAttr);
	const tile: Json = {id};
	const properties = firstChild(el, "properties");
	if (properties) {
		const list = childrenByTag(properties, "property").map(parseProperty);
		if (list.length > 0) tile.properties = list;
	}
	const objectgroup = firstChild(el, "objectgroup");
	if (objectgroup) tile.objectgroup = parseObjectGroup(objectgroup);
	const animation = firstChild(el, "animation");
	if (animation) {
		const frames = childrenByTag(animation, "frame").map((f) => ({
			tileid: Number(f.getAttribute("tileid")),
			duration: Number(f.getAttribute("duration")),
		}));
		if (frames.length > 0) tile.animation = frames;
	}
	return tile;
}

function parseProperty(el: Element): Json {
	const name = el.getAttribute("name") ?? "";
	const type = el.getAttribute("type") ?? "string";
	const raw = el.getAttribute("value") ?? "";
	return {name, type, value: coercePropertyValue(type, raw)};
}

function coercePropertyValue(type: string, raw: string): unknown {
	if (type === "bool") return raw === "true";
	if (type === "int" || type === "object" || type === "float") return Number(raw);
	return raw;
}

function parseObjectGroup(el: Element): Json {
	const objects = childrenByTag(el, "object").map(parseObject);
	return {
		name: el.getAttribute("name") ?? "",
		type: "objectgroup",
		visible: el.getAttribute("visible") !== "0",
		opacity: numberAttr(el, "opacity") ?? 1,
		draworder: el.getAttribute("draworder") ?? "index",
		id: numberAttr(el, "id") ?? 0,
		x: numberAttr(el, "x") ?? 0,
		y: numberAttr(el, "y") ?? 0,
		objects,
	};
}

function parseObject(el: Element): Json {
	return {
		id: numberAttr(el, "id") ?? 0,
		name: el.getAttribute("name") ?? "",
		type: el.getAttribute("type") ?? "",
		x: numberAttr(el, "x") ?? 0,
		y: numberAttr(el, "y") ?? 0,
		width: numberAttr(el, "width") ?? 0,
		height: numberAttr(el, "height") ?? 0,
		rotation: numberAttr(el, "rotation") ?? 0,
		visible: el.getAttribute("visible") !== "0",
	};
}

function childrenByTag(parent: Element, tag: string): Element[] {
	const out: Element[] = [];
	for (const child of Array.from(parent.children)) {
		if (child.tagName === tag) out.push(child);
	}
	return out;
}

function firstChild(parent: Element, tag: string): Element | null {
	for (const child of Array.from(parent.children)) {
		if (child.tagName === tag) return child;
	}
	return null;
}

function copyStringAttr(el: Element, attr: string, target: Json, key: string): void {
	const value = el.getAttribute(attr);
	if (value !== null) target[key] = value;
}

function copyNumberAttr(el: Element, attr: string, target: Json, key: string): void {
	const value = numberAttr(el, attr);
	if (value !== undefined) target[key] = value;
}

function numberAttr(el: Element, attr: string): number | undefined {
	const raw = el.getAttribute(attr);
	if (raw === null) return undefined;
	const value = Number(raw);
	return Number.isFinite(value) ? value : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveUrl(base: string, relative: string): string {
	return new URL(relative, new URL(base, window.location.href)).toString();
}
