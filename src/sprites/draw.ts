import type {SpriteSheet} from "@/types";
import type {ResolvedSpriteAnimationFrame} from "./animations";

export type SheetPadding = {x: number; y: number};

// pad a sheet's drawing canvas so any frame fits even after mirroring its
// per-sprite offsets. mirroring travels with the sprite on each axis, so
// pad symmetrically by the largest absolute offset present in the sheet.
export function computeSheetPadding(sheet: SpriteSheet): SheetPadding {
	let x = 0;
	let y = 0;
	for (const s of sheet) {
		const ax = Math.abs(s.offsetX ?? 0);
		const ay = Math.abs(s.offsetY ?? 0);
		if (ax > x) x = ax;
		if (ay > y) y = ay;
	}
	return {x, y};
}

// per-sprite offsets are art-space: they mirror with the sprite on their
// axis so e.g. walk_right is a true mirror of walk_left rather than bobbing
// the same way. a single setTransform anchors the matrix at the far edge of
// any mirrored axis so the draw call always uses local (0,0).
export function drawSpriteFrame(
	ctx: CanvasRenderingContext2D,
	image: CanvasImageSource,
	frame: ResolvedSpriteAnimationFrame,
	scale: number,
	originX: number,
	originY: number
): void {
	const {sprite, mirrorX, mirrorY} = frame;
	const w = sprite.width * scale;
	const h = sprite.height * scale;
	const dx = originX + (sprite.offsetX ?? 0) * (mirrorX ? -1 : 1) * scale;
	const dy = originY + (sprite.offsetY ?? 0) * (mirrorY ? -1 : 1) * scale;
	ctx.setTransform(
		mirrorX ? -1 : 1,
		0,
		0,
		mirrorY ? -1 : 1,
		mirrorX ? dx + w : dx,
		mirrorY ? dy + h : dy
	);
	ctx.drawImage(image, sprite.x, sprite.y, sprite.width, sprite.height, 0, 0, w, h);
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
	originY: number
): void {
	const {sprite, mirrorX, mirrorY} = frame;
	const w = sprite.width * scale;
	const h = sprite.height * scale;
	const dx = originX + (sprite.offsetX ?? 0) * (mirrorX ? -1 : 1) * scale;
	const dy = originY + (sprite.offsetY ?? 0) * (mirrorY ? -1 : 1) * scale;
	// match drawSpriteFrame's mirror handling, then squish on Y around the
	// sprite's bottom edge so the flattened silhouette stays anchored to the
	// feet.
	const sx = mirrorX ? -1 : 1;
	const sy = (mirrorY ? -1 : 1) * SHADOW_SQUISH_Y;
	const tx = (mirrorX ? dx + w : dx) + SPRITE_SHADOW_OFFSET_X_PX * scale;
	const ty =
		(mirrorY ? dy + h : dy + h * (1 - SHADOW_SQUISH_Y)) + SPRITE_SHADOW_OFFSET_Y_PX * scale;
	ctx.setTransform(sx, 0, 0, sy, tx, ty);
	// brightness(0) collapses rgb to black while preserving the sprite's
	// alpha mask, giving a silhouette without needing an offscreen tint pass.
	ctx.filter = "brightness(0)";
	ctx.globalAlpha = SHADOW_ALPHA;
	ctx.drawImage(image, sprite.x, sprite.y, sprite.width, sprite.height, 0, 0, w, h);
	ctx.globalAlpha = 1;
	ctx.filter = "none";
}
