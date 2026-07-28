import {resolveAnimatedTileId, type AnimationTable} from "@/shared/tiled/animation";
import {decodeTileGid, type TileFlip} from "@/shared/tiled/gid";
import type {ITiledMapObject, ITiledMapObjectLayer} from "@workadventure/tiled-map-type-guard";
import {drawTile} from "./drawTile";
import {findTileImageRect, type LoadedTileset} from "./tileset";

// the debug green, shared with the live overlay (game/debugOverlay.ts) so the
// outlines baked into the map cache and the layers drawn over it every frame
// read as one palette rather than two nearly-identical ones.
export const DEBUG_OBJECT_STYLE = {
	stroke: "#00ff88",
	fill: "rgba(0, 255, 136, 0.22)",
} as const;

export const DEBUG_LINE_WIDTH = 1;

const DEBUG_POINT_RADIUS = 2;

type TileObject = {
	readonly kind: "tile";
	readonly gid: number;
	readonly flip: TileFlip;
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	readonly rotationDeg: number;
};

type BoxObject = {
	readonly kind: "rectangle" | "ellipse" | "text";
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	readonly rotationDeg: number;
};

type PathObject = {
	readonly kind: "polygon" | "polyline";
	readonly x: number;
	readonly y: number;
	readonly points: ReadonlyArray<{readonly x: number; readonly y: number}>;
	readonly rotationDeg: number;
};

type PointObject = {readonly kind: "point"; readonly x: number; readonly y: number};

type ClassifiedObject = TileObject | BoxObject | PathObject | PointObject;

export function drawObjectLayer(
	ctx: CanvasRenderingContext2D,
	layer: ITiledMapObjectLayer,
	tilesets: readonly LoadedTileset[],
	animations: AnimationTable,
	timeMs: number,
	debug: boolean
): void {
	const previousAlpha = ctx.globalAlpha;
	ctx.globalAlpha = previousAlpha * layer.opacity;
	for (const object of layer.objects) {
		if (!object.visible) continue;
		const classified = classifyObject(object);
		if (classified.kind === "tile") {
			drawTileObject(ctx, classified, tilesets, animations, timeMs);
			if (debug) drawDebugTileOutline(ctx, classified);
		} else if (debug) {
			drawDebugShape(ctx, classified);
		}
	}
	ctx.globalAlpha = previousAlpha;
}

function classifyObject(object: ITiledMapObject): ClassifiedObject {
	const rotationDeg = object.rotation ?? 0;
	if (object.gid !== undefined) {
		const decoded = decodeTileGid(object.gid);
		return {
			kind: "tile",
			gid: decoded.id,
			flip: decoded.flip,
			x: object.x,
			y: object.y,
			width: object.width ?? 0,
			height: object.height ?? 0,
			rotationDeg,
		};
	}
	if (object.point) return {kind: "point", x: object.x, y: object.y};
	if (object.polygon)
		return {kind: "polygon", x: object.x, y: object.y, points: object.polygon, rotationDeg};
	if (object.polyline)
		return {kind: "polyline", x: object.x, y: object.y, points: object.polyline, rotationDeg};
	const width = object.width ?? 0;
	const height = object.height ?? 0;
	if (object.ellipse)
		return {kind: "ellipse", x: object.x, y: object.y, width, height, rotationDeg};
	if (object.text) return {kind: "text", x: object.x, y: object.y, width, height, rotationDeg};
	return {kind: "rectangle", x: object.x, y: object.y, width, height, rotationDeg};
}

function drawTileObject(
	ctx: CanvasRenderingContext2D,
	object: TileObject,
	tilesets: readonly LoadedTileset[],
	animations: AnimationTable,
	timeMs: number
): void {
	const resolvedId = resolveAnimatedTileId(animations, object.gid, timeMs);
	const rect = findTileImageRect(tilesets, resolvedId);
	if (!rect) return;
	const width = object.width || rect.sw;
	const height = object.height || rect.sh;
	ctx.save();
	ctx.translate(object.x, object.y);
	if (object.rotationDeg !== 0) ctx.rotate((object.rotationDeg * Math.PI) / 180);
	drawTile(ctx, rect, 0, -height, width, height, object.flip);
	ctx.restore();
}

function drawDebugTileOutline(ctx: CanvasRenderingContext2D, object: TileObject): void {
	const width = object.width || 0;
	const height = object.height || 0;
	if (width === 0 || height === 0) return;
	withDebugStyle(ctx, object.x, object.y, object.rotationDeg, () => {
		ctx.strokeRect(0, -height, width, height);
	});
}

function drawDebugShape(
	ctx: CanvasRenderingContext2D,
	object: Exclude<ClassifiedObject, TileObject>
): void {
	if (object.kind === "point") {
		withDebugStyle(ctx, object.x, object.y, 0, () => drawDebugPoint(ctx));
		return;
	}
	withDebugStyle(ctx, object.x, object.y, object.rotationDeg, () => drawDebugBody(ctx, object));
}

function drawDebugBody(ctx: CanvasRenderingContext2D, object: BoxObject | PathObject): void {
	switch (object.kind) {
		case "rectangle":
		case "text":
			ctx.fillRect(0, 0, object.width, object.height);
			ctx.strokeRect(0, 0, object.width, object.height);
			return;
		case "ellipse":
			ctx.beginPath();
			ctx.ellipse(
				object.width / 2,
				object.height / 2,
				object.width / 2,
				object.height / 2,
				0,
				0,
				Math.PI * 2
			);
			ctx.fill();
			ctx.stroke();
			return;
		case "polygon":
		case "polyline":
			ctx.beginPath();
			object.points.forEach((p, i) =>
				i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)
			);
			if (object.kind === "polygon") {
				ctx.closePath();
				ctx.fill();
			}
			ctx.stroke();
			return;
	}
}

function drawDebugPoint(ctx: CanvasRenderingContext2D): void {
	ctx.beginPath();
	ctx.arc(0, 0, DEBUG_POINT_RADIUS, 0, Math.PI * 2);
	ctx.fill();
	ctx.stroke();
}

function withDebugStyle(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	rotationDeg: number,
	draw: () => void
): void {
	ctx.save();
	ctx.translate(x, y);
	if (rotationDeg !== 0) ctx.rotate((rotationDeg * Math.PI) / 180);
	ctx.strokeStyle = DEBUG_OBJECT_STYLE.stroke;
	ctx.fillStyle = DEBUG_OBJECT_STYLE.fill;
	ctx.lineWidth = DEBUG_LINE_WIDTH;
	draw();
	ctx.restore();
}
