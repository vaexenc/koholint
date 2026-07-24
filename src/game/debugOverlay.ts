import type {CliffGrid, SolidGrid} from "./collision";
import {forEachPushCell, type PushGrid} from "./push";
import type {TeleporterGrid} from "./teleport";
import {forEachStairsCell, forEachSwimCell, type TerrainGrid} from "./terrain";
import type {World} from "./world";

export type DebugOverlayOptions = {
	readonly solids: boolean;
	readonly objects: boolean;
	readonly holes: boolean;
	readonly cliffs: boolean;
	readonly push: boolean;
	readonly swim: boolean;
	readonly stairs: boolean;
	readonly teleporters: boolean;
	readonly hitboxes: boolean;
};

export const DEFAULT_DEBUG_OVERLAY: DebugOverlayOptions = {
	solids: false,
	objects: false,
	holes: false,
	cliffs: false,
	push: false,
	swim: false,
	stairs: false,
	teleporters: false,
	hitboxes: false,
};

export const DEBUG_OVERLAY_ALL: DebugOverlayOptions = {
	solids: true,
	objects: true,
	holes: true,
	cliffs: true,
	push: true,
	swim: true,
	stairs: true,
	teleporters: true,
	hitboxes: true,
};

type Style = {readonly stroke: string; readonly fill: string};

const STYLE = {
	solids: {stroke: "#ff3344", fill: "rgba(255, 51, 68, 0.22)"},
	holes: {stroke: "#3399ff", fill: "rgba(51, 153, 255, 0.25)"},
	cliffs: {stroke: "#ffaa00", fill: "rgba(255, 170, 0, 0.22)"},
	push: {stroke: "#22ddaa", fill: "rgba(34, 221, 170, 0.20)"},
	swim: {stroke: "#33ccff", fill: "rgba(51, 204, 255, 0.18)"},
	stairs: {stroke: "#ffdd33", fill: "rgba(255, 221, 51, 0.18)"},
	teleporters: {stroke: "#ff44ff", fill: "rgba(255, 68, 255, 0.18)"},
	hitboxes: {stroke: "#00ff88", fill: "rgba(0, 255, 136, 0.22)"},
} as const satisfies Record<string, Style>;

const LINE_WIDTH = 1;

// keys of the layers baked into the cached bitmap (everything except hitboxes,
// which move with the characters and are redrawn live every frame).
type StaticKey = Exclude<keyof DebugOverlayOptions, "objects" | "hitboxes">;
const STATIC_KEYS: readonly StaticKey[] = [
	"solids",
	"holes",
	"swim",
	"stairs",
	"cliffs",
	"push",
	"teleporters",
];

// caches the static debug layers into an offscreen bitmap so a frame only pays
// for a single drawImage plus the live hitboxes, instead of re-stroking every
// grid cell. the bitmap is rebuilt only when the set of enabled static layers
// changes, which in practice happens just when the overlay is toggled.
export type DebugOverlay = {
	draw(ctx: CanvasRenderingContext2D, world: World, options: DebugOverlayOptions): void;
};

export function createDebugOverlay(width: number, height: number): DebugOverlay {
	// the cache bitmap is map-sized (tens of MB), so it is only allocated once
	// a static layer is actually enabled — the overlay is an admin diagnostic
	// and everyone else shouldn't pay for it.
	let cache: {canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D} | null = null;
	let cachedSignature: string | null = null;
	let hasStaticLayers = false;

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
		hasStaticLayers = false;
		if (!cache && !STATIC_KEYS.some((key) => options[key])) return;
		const c = ensureCache();
		if (!c) return;
		c.ctx.clearRect(0, 0, width, height);
		c.ctx.lineWidth = LINE_WIDTH;
		hasStaticLayers = drawStaticLayers(c.ctx, world, options);
	};

	return {
		draw(ctx, world, options) {
			const signature = STATIC_KEYS.map((key) => (options[key] ? "1" : "0")).join("");
			if (signature !== cachedSignature) {
				cachedSignature = signature;
				rebuild(world, options);
			}
			ctx.save();
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			if (hasStaticLayers && cache) ctx.drawImage(cache.canvas, 0, 0);
			if (options.hitboxes) {
				ctx.lineWidth = LINE_WIDTH;
				drawHitboxes(ctx, world, STYLE.hitboxes);
			}
			ctx.restore();
		},
	};
}

// returns whether any static layer actually drew, so the frame can skip the
// blit when the overlay is off.
function drawStaticLayers(
	ctx: CanvasRenderingContext2D,
	world: World,
	options: DebugOverlayOptions
): boolean {
	let drew = false;
	if (options.solids) drew = drawCellGrid(ctx, world.grid, STYLE.solids) || drew;
	if (options.holes && world.holes) drew = drawCellGrid(ctx, world.holes, STYLE.holes) || drew;
	if (options.swim && world.terrain) drew = drawSwim(ctx, world.terrain, STYLE.swim) || drew;
	if (options.stairs && world.terrain)
		drew = drawStairs(ctx, world.terrain, STYLE.stairs) || drew;
	if (options.cliffs && world.cliffs) drew = drawCliffs(ctx, world.cliffs, STYLE.cliffs) || drew;
	if (options.push && world.push) drew = drawPush(ctx, world.push, STYLE.push) || drew;
	if (options.teleporters && world.teleporters)
		drew = drawTeleporters(ctx, world.teleporters, STYLE.teleporters) || drew;
	return drew;
}

function drawHitboxes(ctx: CanvasRenderingContext2D, world: World, style: Style): void {
	const path = new Path2D();
	for (const char of world.characters.values()) {
		const b = char.collisionBox;
		path.rect(char.x + b.x, char.y + b.y, b.width, b.height);
	}
	fillStroke(ctx, path, style);
}

function drawCellGrid(ctx: CanvasRenderingContext2D, grid: SolidGrid, style: Style): boolean {
	const path = new Path2D();
	for (let row = 0; row < grid.height; row++) {
		for (let col = 0; col < grid.width; col++) {
			if (grid.cells[row * grid.width + col] === 0) continue;
			path.rect(col * grid.tileWidth, row * grid.tileHeight, grid.tileWidth, grid.tileHeight);
		}
	}
	return fillStroke(ctx, path, style);
}

function drawSwim(ctx: CanvasRenderingContext2D, terrain: TerrainGrid, style: Style): boolean {
	const path = new Path2D();
	forEachSwimCell(terrain, (col, row) => {
		path.rect(
			col * terrain.tileWidth,
			row * terrain.tileHeight,
			terrain.tileWidth,
			terrain.tileHeight
		);
	});
	return fillStroke(ctx, path, style);
}

function drawStairs(ctx: CanvasRenderingContext2D, terrain: TerrainGrid, style: Style): boolean {
	const path = new Path2D();
	forEachStairsCell(terrain, (col, row) => {
		path.rect(
			col * terrain.tileWidth,
			row * terrain.tileHeight,
			terrain.tileWidth,
			terrain.tileHeight
		);
	});
	return fillStroke(ctx, path, style);
}

function drawCliffs(ctx: CanvasRenderingContext2D, cliffs: CliffGrid, style: Style): boolean {
	const path = new Path2D();
	for (const r of cliffs.regions) path.rect(r.x, r.y, r.width, r.height);
	return fillStroke(ctx, path, style);
}

// each push cell is tinted and gets a line from its center toward the push
// direction so the conveyor flow is readable at a glance.
function drawPush(ctx: CanvasRenderingContext2D, push: PushGrid, style: Style): boolean {
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
	return true;
}

function drawTeleporters(
	ctx: CanvasRenderingContext2D,
	teleporters: TeleporterGrid,
	style: Style
): boolean {
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
	return true;
}

function fillStroke(ctx: CanvasRenderingContext2D, path: Path2D, style: Style): boolean {
	applyStyle(ctx, style);
	ctx.fill(path);
	ctx.stroke(path);
	return true;
}

function applyStyle(ctx: CanvasRenderingContext2D, style: Style): void {
	ctx.strokeStyle = style.stroke;
	ctx.fillStyle = style.fill;
}
