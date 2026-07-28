import {DEBUG_LINE_WIDTH, DEBUG_OBJECT_STYLE} from "@/client/tiled/objects";
import {forEachCell} from "@/shared/game/cellGrid";
import type {CliffGrid} from "@/shared/game/cliffs";
import type {SolidGrid} from "@/shared/game/collision";
import {forEachPushCell, type PushGrid} from "@/shared/game/push";
import type {TeleporterGrid} from "@/shared/game/teleport";
import {forEachStairsCell, forEachSwimCell, type TerrainGrid} from "@/shared/game/terrain";
import type {World} from "@/shared/game/world";

type Style = {readonly stroke: string; readonly fill: string};

type LayerDraw = (ctx: CanvasRenderingContext2D, world: World, style: Style) => void;

// where a layer's pixels come from. "cache" layers are stroked into this
// module's offscreen bitmap and redrawn only when the enabled set changes;
// "frame" layers move with the characters, so they redraw every frame; a
// "mapBake" layer is stamped in by the map render cache (see tiled/objects.ts)
// and appears here only so the option it owns can't go unhandled.
type LayerSpec = {readonly key: string} & (
	| {readonly source: "cache" | "frame"; readonly style: Style; readonly draw: LayerDraw}
	| {readonly source: "mapBake"}
);

// the one declaration of the debug overlay. the options type, the all-on/all-off
// pair, the cache-invalidation signature and the draw order are all derived from
// it, so adding a layer is one entry here — previously it was five hand-kept
// structures of which only one was compile-checked, and a layer missing from the
// key list silently never drew and silently couldn't be toggled.
//
// array order is draw order: later layers stroke over earlier ones.
const LAYERS = [
	{
		key: "solids",
		source: "cache",
		style: {stroke: "#ff3344", fill: "rgba(255, 51, 68, 0.22)"},
		draw: (ctx, world, style) => drawCellGrid(ctx, world.grids.solid, style),
	},
	{
		key: "holes",
		source: "cache",
		style: {stroke: "#3399ff", fill: "rgba(51, 153, 255, 0.25)"},
		draw: (ctx, world, style) => drawCellGrid(ctx, world.grids.holes, style),
	},
	{
		key: "swim",
		source: "cache",
		style: {stroke: "#33ccff", fill: "rgba(51, 204, 255, 0.18)"},
		draw: (ctx, world, style) =>
			drawTerrainCells(ctx, world.grids.terrain, forEachSwimCell, style),
	},
	{
		key: "stairs",
		source: "cache",
		style: {stroke: "#ffdd33", fill: "rgba(255, 221, 51, 0.18)"},
		draw: (ctx, world, style) =>
			drawTerrainCells(ctx, world.grids.terrain, forEachStairsCell, style),
	},
	{
		key: "cliffs",
		source: "cache",
		style: {stroke: "#ffaa00", fill: "rgba(255, 170, 0, 0.22)"},
		draw: (ctx, world, style) => drawCliffs(ctx, world.grids.cliffs, style),
	},
	{
		key: "push",
		source: "cache",
		style: {stroke: "#22ddaa", fill: "rgba(34, 221, 170, 0.20)"},
		draw: (ctx, world, style) => drawPush(ctx, world.grids.push, style),
	},
	{
		key: "teleporters",
		source: "cache",
		style: {stroke: "#ff44ff", fill: "rgba(255, 68, 255, 0.18)"},
		draw: (ctx, world, style) => drawTeleporters(ctx, world.grids.teleporters, style),
	},
	{
		key: "hitboxes",
		source: "frame",
		// map objects are outlined in the same green during the cache bake, so the
		// two halves of the overlay read as one palette.
		style: DEBUG_OBJECT_STYLE,
		draw: drawHitboxes,
	},
	{key: "objects", source: "mapBake"},
] as const satisfies readonly LayerSpec[];

export type DebugOverlayOptions = {
	readonly [K in (typeof LAYERS)[number]["key"]]: boolean;
};

// every layer on or every layer off — the toggle is one checkbox, so these are
// the only two values in play. the return type is derived from LAYERS, so a
// layer added there fails to compile here until it is handled.
function everyLayer(enabled: boolean): DebugOverlayOptions {
	return {
		solids: enabled,
		holes: enabled,
		swim: enabled,
		stairs: enabled,
		cliffs: enabled,
		push: enabled,
		teleporters: enabled,
		hitboxes: enabled,
		objects: enabled,
	};
}

export const DEFAULT_DEBUG_OVERLAY: DebugOverlayOptions = everyLayer(false);

export const DEBUG_OVERLAY_ALL: DebugOverlayOptions = everyLayer(true);

const LINE_WIDTH = DEBUG_LINE_WIDTH;

// caches the layers baked into an offscreen bitmap so a frame only pays for a
// single drawImage plus the live ones, instead of re-stroking every grid cell.
// the bitmap is rebuilt only when the set of enabled cached layers changes,
// which in practice happens just when the overlay is toggled.
export type DebugOverlay = {
	// draws in world pixels under the caller's transform, so it can go into a
	// bitmap that only covers the visible part of the map.
	draw(ctx: CanvasRenderingContext2D, world: World, options: DebugOverlayOptions): void;
};

export function createDebugOverlay(width: number, height: number): DebugOverlay {
	// the cache bitmap is map-sized (tens of MB), so it is only allocated once
	// a cached layer is actually enabled — the overlay is an admin diagnostic
	// and everyone else shouldn't pay for it.
	let cache: {canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D} | null = null;
	let cachedSignature: string | null = null;
	let hasCachedLayers = false;

	const ensureCache = () => {
		if (cache) return cache;
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext("2d");
		if (!ctx) return null;
		cache = {canvas, ctx};
		return cache;
	};

	const rebuild = (world: World, options: DebugOverlayOptions): void => {
		hasCachedLayers = LAYERS.some((l) => l.source === "cache" && options[l.key]);
		if (!cache && !hasCachedLayers) return;
		const c = ensureCache();
		if (!c) return;
		c.ctx.clearRect(0, 0, width, height);
		c.ctx.lineWidth = LINE_WIDTH;
		drawLayers(c.ctx, world, options, "cache");
	};

	return {
		draw(ctx, world, options) {
			let signature = "";
			for (const layer of LAYERS)
				if (layer.source === "cache") signature += options[layer.key] ? "1" : "0";
			if (signature !== cachedSignature) {
				cachedSignature = signature;
				rebuild(world, options);
			}
			const hasFrameLayers = LAYERS.some((l) => l.source === "frame" && options[l.key]);
			if (!hasCachedLayers && !hasFrameLayers) return;
			ctx.save();
			if (hasCachedLayers && cache) ctx.drawImage(cache.canvas, 0, 0);
			if (hasFrameLayers) {
				ctx.lineWidth = LINE_WIDTH;
				drawLayers(ctx, world, options, "frame");
			}
			ctx.restore();
		},
	};
}

function drawLayers(
	ctx: CanvasRenderingContext2D,
	world: World,
	options: DebugOverlayOptions,
	source: "cache" | "frame"
): void {
	for (const layer of LAYERS) {
		if (layer.source !== source || !options[layer.key]) continue;
		layer.draw(ctx, world, layer.style);
	}
}

function drawHitboxes(ctx: CanvasRenderingContext2D, world: World, style: Style): void {
	const path = new Path2D();
	for (const char of world.characters.values()) {
		const b = char.collisionBox;
		path.rect(char.x + b.x, char.y + b.y, b.width, b.height);
	}
	fillStroke(ctx, path, style);
}

function drawCellGrid(ctx: CanvasRenderingContext2D, grid: SolidGrid, style: Style): void {
	const path = new Path2D();
	forEachCell(grid, (col, row, index) => {
		if (grid.cells[index] === 0) return;
		path.rect(col * grid.tileWidth, row * grid.tileHeight, grid.tileWidth, grid.tileHeight);
	});
	fillStroke(ctx, path, style);
}

// tints whichever terrain flag `forEach` selects; swim and stairs differ only in
// that iterator.
function drawTerrainCells(
	ctx: CanvasRenderingContext2D,
	terrain: TerrainGrid,
	forEach: (grid: TerrainGrid, visit: (col: number, row: number) => void) => void,
	style: Style
): void {
	const path = new Path2D();
	forEach(terrain, (col, row) => {
		path.rect(
			col * terrain.tileWidth,
			row * terrain.tileHeight,
			terrain.tileWidth,
			terrain.tileHeight
		);
	});
	fillStroke(ctx, path, style);
}

function drawCliffs(ctx: CanvasRenderingContext2D, cliffs: CliffGrid, style: Style): void {
	const path = new Path2D();
	for (const r of cliffs.regions) path.rect(r.x, r.y, r.width, r.height);
	fillStroke(ctx, path, style);
}

// each push cell is tinted and gets a line from its center toward the push
// direction so the conveyor flow is readable at a glance.
function drawPush(ctx: CanvasRenderingContext2D, push: PushGrid, style: Style): void {
	const cells = new Path2D();
	const arrows = new Path2D();
	forEachPushCell(push, (col, row, v) => {
		const x = col * push.tileWidth;
		const y = row * push.tileHeight;
		cells.rect(x, y, push.tileWidth, push.tileHeight);
		const cx = x + push.tileWidth / 2;
		const cy = y + push.tileHeight / 2;
		const len = Math.hypot(v.x, v.y) || 1;
		const reach = Math.min(push.tileWidth, push.tileHeight) / 2 - 2;
		arrows.moveTo(cx, cy);
		arrows.lineTo(cx + (v.x / len) * reach, cy + (v.y / len) * reach);
	});
	applyStyle(ctx, style);
	ctx.fill(cells);
	ctx.stroke(cells);
	ctx.stroke(arrows);
}

function drawTeleporters(
	ctx: CanvasRenderingContext2D,
	teleporters: TeleporterGrid,
	style: Style
): void {
	const boxes = new Path2D();
	const links = new Path2D();
	for (const t of teleporters.all) {
		const {box} = t;
		boxes.rect(box.x, box.y, box.width, box.height);
		const target = teleporters.byId.get(t.targetId);
		if (!target) continue;
		links.moveTo(box.x + box.width / 2, box.y + box.height / 2);
		links.lineTo(
			target.box.x + target.box.width / 2 + t.destOffsetX,
			target.box.y + target.box.height / 2 + t.destOffsetY
		);
	}
	applyStyle(ctx, style);
	ctx.fill(boxes);
	ctx.stroke(boxes);
	ctx.stroke(links);
}

function fillStroke(ctx: CanvasRenderingContext2D, path: Path2D, style: Style): void {
	applyStyle(ctx, style);
	ctx.fill(path);
	ctx.stroke(path);
}

function applyStyle(ctx: CanvasRenderingContext2D, style: Style): void {
	ctx.strokeStyle = style.stroke;
	ctx.fillStyle = style.fill;
}
