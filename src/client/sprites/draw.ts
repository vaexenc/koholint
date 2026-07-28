import type {ResolvedSpriteAnimationFrame} from "@/shared/sprites/animations";
import {sheetFootprint} from "@/shared/sprites/sheet";
import type {SpriteAsset, SpritePalette, SpriteSheet} from "@/shared/sprites/types";
import {recolorImageCached} from "./paletteSwap";

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

// translate/scale anchor the draw at the far edge of any mirrored axis so the
// draw call always uses local (0,0). composed (not setTransform) so callers may
// draw through an outer transform, e.g. the camera. save/restore the ctx so
// the mirrored transform doesn't leak into the next caller.
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
	ctx.translate(mirrorX ? dx + w : dx, mirrorY ? dy + h : dy);
	ctx.scale(mirrorX ? -1 : 1, mirrorY ? -1 : 1);
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
	// `image` is a pre-baked black silhouette (see bakeSilhouette), so the
	// shadow is a plain alpha-blended blit. drawing it with a live `ctx.filter`
	// instead would allocate an offscreen surface per sprite every frame and
	// dominate the frame once many characters are on screen. composed with the
	// current transform, like drawSpriteFrame.
	ctx.save();
	ctx.translate(tx, ty);
	ctx.scale(sx, sy);
	ctx.globalAlpha = SHADOW_ALPHA;
	ctx.drawImage(image, sprite.x, sprite.y, sprite.width, sprite.height, 0, 0, w, h);
	ctx.restore();
}

// bakes a black silhouette of a sprite sheet once at load time so shadows draw
// with a plain blit. `source-in` keeps the fill only where the sheet has alpha,
// preserving edge antialiasing without depending on canvas filter support.
function bakeSilhouette(source: SpriteSource, width: number, height: number): HTMLCanvasElement {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");
	if (!ctx) return canvas;
	ctx.drawImage(source, 0, 0);
	ctx.globalCompositeOperation = "source-in";
	ctx.fillStyle = "#000";
	ctx.fillRect(0, 0, width, height);
	return canvas;
}

// a sprite sheet source: the raw image or a recolored canvas copy of it.
export type SpriteSource = HTMLImageElement | HTMLCanvasElement;

// the pixels an appearance draws from: the shared decoded sheet, or the shared
// palette-swapped canvas when it wears a palette. the recolor is cached per
// (image × palette), so the world renderer, a picker preview and a chat row's
// icon all draw one appearance from one bitmap — and, being the only place the
// choice is made, they can't disagree about which.
export function resolveSpriteSource(
	image: HTMLImageElement,
	sprite: SpriteAsset,
	paletteSwap: SpritePalette | undefined
): SpriteSource {
	if (!sprite.palette || !paletteSwap) return image;
	return recolorImageCached(image, sprite.palette, paletteSwap) ?? image;
}

// one baked shadow silhouette per source, shared by every consumer drawing
// that appearance. WeakMap so an entry lives exactly as long as its
// (module-cached) source does.
const silhouetteCache = new WeakMap<SpriteSource, HTMLCanvasElement>();

export function silhouetteFor(source: SpriteSource): HTMLCanvasElement {
	const cached = silhouetteCache.get(source);
	if (cached) return cached;
	const isImage = source instanceof HTMLImageElement;
	const baked = bakeSilhouette(
		source,
		isImage ? source.naturalWidth : source.width,
		isImage ? source.naturalHeight : source.height
	);
	silhouetteCache.set(source, baked);
	return baked;
}
