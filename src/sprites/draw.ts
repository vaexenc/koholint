import type {SpriteSheet} from "@/types";
import type {ResolvedSpriteAnimationFrame} from "./animations";
import {sheetFootprint} from "./sheet";

export type SheetPadding = {x: number; top: number; bottom: number};

// pad a sheet's drawing canvas so any frame fits around the logical
// footprint box. horizontal padding is symmetric because x-mirroring (used
// pervasively by the animation sets) swaps a frame's left/right overhangs;
// vertical padding is per-side since tall art only ever hangs above the
// anchor and reserving the mirrored space below would float the sprite up.
export function computeSheetPadding(sheet: SpriteSheet): SheetPadding {
	const footprint = sheetFootprint(sheet);
	let x = 0;
	let top = 0;
	let bottom = 0;
	for (const s of sheet) {
		const ox = s.offsetX ?? 0;
		const oy = s.offsetY ?? 0;
		x = Math.max(x, -ox, ox + s.width - footprint.width);
		top = Math.max(top, -oy);
		bottom = Math.max(bottom, oy + s.height - footprint.height);
	}
	return {x, top, bottom};
}

// mirroring flips the composed frame (rect + art-space offsets) about the
// center of the character's logical footprint, so walk_right is a true mirror
// of walk_left and frames wider than the footprint (e.g. din's flying hair)
// keep their body anchored on the same spot. for the common 16px-wide frame
// this reduces to flipping in place with the offset sign inverted.
function frameTopLeft(
	frame: ResolvedSpriteAnimationFrame,
	footprintWidth: number,
	footprintHeight: number
): {x: number; y: number} {
	const {sprite, mirrorX, mirrorY} = frame;
	const ox = sprite.offsetX ?? 0;
	const oy = sprite.offsetY ?? 0;
	return {
		x: mirrorX ? footprintWidth - ox - sprite.width : ox,
		y: mirrorY ? footprintHeight - oy - sprite.height : oy,
	};
}

// a single setTransform anchors the matrix at the far edge of any mirrored
// axis so the draw call always uses local (0,0). save/restore the ctx so the
// mirrored transform doesn't leak into the next caller.
export function drawSpriteFrame(
	ctx: CanvasRenderingContext2D,
	image: CanvasImageSource,
	frame: ResolvedSpriteAnimationFrame,
	scale: number,
	originX: number,
	originY: number,
	footprintWidth: number,
	footprintHeight: number
): void {
	const {sprite, mirrorX, mirrorY} = frame;
	const w = sprite.width * scale;
	const h = sprite.height * scale;
	const topLeft = frameTopLeft(frame, footprintWidth, footprintHeight);
	const dx = originX + topLeft.x * scale;
	const dy = originY + topLeft.y * scale;
	ctx.save();
	ctx.setTransform(
		mirrorX ? -1 : 1,
		0,
		0,
		mirrorY ? -1 : 1,
		mirrorX ? dx + w : dx,
		mirrorY ? dy + h : dy
	);
	ctx.drawImage(image, sprite.x, sprite.y, sprite.width, sprite.height, 0, 0, w, h);
	ctx.restore();
}

// art-space shadow tuning. squish flattens the silhouette toward the ground;
// the offset shifts it down-right so the sprite reads as lit from upper-left.
export const SPRITE_SHADOW_OFFSET_X_PX = 3;
export const SPRITE_SHADOW_OFFSET_Y_PX = 1;
const SHADOW_SQUISH_Y = 0.6;
const SHADOW_ALPHA = 0.35;

export function drawSpriteShadow(
	ctx: CanvasRenderingContext2D,
	image: CanvasImageSource,
	frame: ResolvedSpriteAnimationFrame,
	scale: number,
	originX: number,
	originY: number,
	footprintWidth: number,
	footprintHeight: number
): void {
	const {sprite, mirrorX, mirrorY} = frame;
	const w = sprite.width * scale;
	const h = sprite.height * scale;
	const topLeft = frameTopLeft(frame, footprintWidth, footprintHeight);
	const dx = originX + topLeft.x * scale;
	const dy = originY + topLeft.y * scale;
	// match drawSpriteFrame's mirror handling, then squish on Y around the
	// sprite's bottom edge so the flattened silhouette stays anchored to the
	// feet.
	const sx = mirrorX ? -1 : 1;
	const sy = (mirrorY ? -1 : 1) * SHADOW_SQUISH_Y;
	const tx = (mirrorX ? dx + w : dx) + SPRITE_SHADOW_OFFSET_X_PX * scale;
	const ty =
		(mirrorY ? dy + h : dy + h * (1 - SHADOW_SQUISH_Y)) + SPRITE_SHADOW_OFFSET_Y_PX * scale;
	ctx.save();
	ctx.setTransform(sx, 0, 0, sy, tx, ty);
	// brightness(0) collapses rgb to black while preserving the sprite's
	// alpha mask, giving a silhouette without needing an offscreen tint pass.
	ctx.filter = "brightness(0)";
	ctx.globalAlpha = SHADOW_ALPHA;
	ctx.drawImage(image, sprite.x, sprite.y, sprite.width, sprite.height, 0, 0, w, h);
	ctx.restore();
}
