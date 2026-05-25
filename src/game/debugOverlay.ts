import type {CliffGrid, SolidGrid} from "./collision";
import type {TeleporterGrid} from "./teleport";
import {forEachStairsCell, forEachSwimCell, type TerrainGrid} from "./terrain";
import type {World} from "./world";

export type DebugOverlayOptions = {
	readonly solids: boolean;
	readonly objects: boolean;
	readonly holes: boolean;
	readonly cliffs: boolean;
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
	swim: {stroke: "#33ccff", fill: "rgba(51, 204, 255, 0.18)"},
	stairs: {stroke: "#ffdd33", fill: "rgba(255, 221, 51, 0.18)"},
	teleporters: {stroke: "#ff44ff", fill: "rgba(255, 68, 255, 0.18)"},
	hitboxes: {stroke: "#00ff88", fill: "rgba(0, 255, 136, 0.22)"},
} as const satisfies Record<string, Style>;

const LINE_WIDTH = 1;

// draws non-object debug layers on top of the tiled scene. "objects" is
// handled inside drawObjectLayer because it needs per-object classification
// data that isn't worth recomputing here. resets the transform to identity
// because the sprite renderer leaves the ctx in per-character local space.
export function drawDebugOverlay(
	ctx: CanvasRenderingContext2D,
	world: World,
	options: DebugOverlayOptions
): void {
	ctx.save();
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.lineWidth = LINE_WIDTH;
	if (options.solids) drawCellGrid(ctx, world.grid, STYLE.solids);
	if (options.holes && world.holes) drawCellGrid(ctx, world.holes, STYLE.holes);
	if (options.swim && world.terrain) drawSwim(ctx, world.terrain, STYLE.swim);
	if (options.stairs && world.terrain) drawStairs(ctx, world.terrain, STYLE.stairs);
	if (options.cliffs && world.cliffs) drawCliffs(ctx, world.cliffs, STYLE.cliffs);
	if (options.teleporters && world.teleporters)
		drawTeleporters(ctx, world.teleporters, STYLE.teleporters);
	if (options.hitboxes) drawHitboxes(ctx, world, STYLE.hitboxes);
	ctx.restore();
}

function drawHitboxes(ctx: CanvasRenderingContext2D, world: World, style: Style): void {
	applyStyle(ctx, style);
	for (const char of world.characters.values()) {
		const b = char.collisionBox;
		const x = char.x + b.x;
		const y = char.y + b.y;
		ctx.fillRect(x, y, b.width, b.height);
		ctx.strokeRect(x, y, b.width, b.height);
	}
}

function drawCellGrid(ctx: CanvasRenderingContext2D, grid: SolidGrid, style: Style): void {
	applyStyle(ctx, style);
	for (let row = 0; row < grid.height; row++) {
		for (let col = 0; col < grid.width; col++) {
			if (grid.cells[row * grid.width + col] === 0) continue;
			drawCell(ctx, col, row, grid.tileWidth, grid.tileHeight);
		}
	}
}

function drawSwim(ctx: CanvasRenderingContext2D, terrain: TerrainGrid, style: Style): void {
	applyStyle(ctx, style);
	forEachSwimCell(terrain, (col, row) => {
		drawCell(ctx, col, row, terrain.tileWidth, terrain.tileHeight);
	});
}

function drawStairs(ctx: CanvasRenderingContext2D, terrain: TerrainGrid, style: Style): void {
	applyStyle(ctx, style);
	forEachStairsCell(terrain, (col, row) => {
		drawCell(ctx, col, row, terrain.tileWidth, terrain.tileHeight);
	});
}

function drawCliffs(ctx: CanvasRenderingContext2D, cliffs: CliffGrid, style: Style): void {
	applyStyle(ctx, style);
	for (const r of cliffs.regions) {
		ctx.fillRect(r.x, r.y, r.width, r.height);
		ctx.strokeRect(r.x, r.y, r.width, r.height);
	}
}

function drawTeleporters(
	ctx: CanvasRenderingContext2D,
	teleporters: TeleporterGrid,
	style: Style
): void {
	applyStyle(ctx, style);
	for (const t of teleporters.all) {
		const {box} = t;
		ctx.fillRect(box.x, box.y, box.width, box.height);
		ctx.strokeRect(box.x, box.y, box.width, box.height);
		const target = teleporters.byId.get(t.targetId);
		if (!target) continue;
		const sx = box.x + box.width / 2;
		const sy = box.y + box.height / 2;
		const tx = target.box.x + target.box.width / 2 + t.destOffsetX;
		const ty = target.box.y + target.box.height / 2 + t.destOffsetY;
		ctx.beginPath();
		ctx.moveTo(sx, sy);
		ctx.lineTo(tx, ty);
		ctx.stroke();
	}
}

function applyStyle(ctx: CanvasRenderingContext2D, style: Style): void {
	ctx.strokeStyle = style.stroke;
	ctx.fillStyle = style.fill;
}

function drawCell(
	ctx: CanvasRenderingContext2D,
	col: number,
	row: number,
	tileWidth: number,
	tileHeight: number
): void {
	const x = col * tileWidth;
	const y = row * tileHeight;
	ctx.fillRect(x, y, tileWidth, tileHeight);
	ctx.strokeRect(x, y, tileWidth, tileHeight);
}
