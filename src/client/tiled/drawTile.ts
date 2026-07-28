import {isFlipped, type TileFlip} from "@/shared/tiled/gid";
import type {TileImageRect} from "./tileset";

export function drawTile(
	ctx: CanvasRenderingContext2D,
	rect: TileImageRect,
	dx: number,
	dy: number,
	dw: number,
	dh: number,
	flip: TileFlip
): void {
	if (!isFlipped(flip)) {
		ctx.drawImage(rect.image, rect.sx, rect.sy, rect.sw, rect.sh, dx, dy, dw, dh);
		return;
	}
	ctx.save();
	ctx.translate(dx + dw / 2, dy + dh / 2);
	if (flip.diagonal) {
		ctx.rotate(Math.PI / 2);
		ctx.scale(-1, 1);
	}
	ctx.scale(flip.horizontal ? -1 : 1, flip.vertical ? -1 : 1);
	ctx.drawImage(rect.image, rect.sx, rect.sy, rect.sw, rect.sh, -dw / 2, -dh / 2, dw, dh);
	ctx.restore();
}
