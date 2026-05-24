import {
	getAnimationFrame,
	type ResolvedSpriteAnimationFrame,
	type SpriteAnimation,
} from "@/sprites/animations";
import {buildColorMap, recolorImage} from "@/sprites/paletteSwap";
import type {SpriteAsset, SpritePalette, SpriteSheet} from "@/types";
import {useEffect, useMemo, useRef, useState} from "react";

function useSpriteImage(url: string): HTMLImageElement | null {
	const [img, setImg] = useState<HTMLImageElement | null>(null);
	useEffect(() => {
		let cancelled = false;
		const image = new Image();
		image.onload = () => {
			if (!cancelled) setImg(image);
		};
		image.src = url;
		return () => {
			cancelled = true;
		};
	}, [url]);
	return img;
}

type SheetPadding = {x: number; y: number};

// pad the canvas so any sprite can draw fully within bounds. offsets are
// applied in art-space (mirror along with the sprite), so a sprite with
// a non-zero offset may stick out either side depending on which axes the
// active frame is mirrored on; we pad both sides of each axis symmetrically
// by the largest absolute offset in the sheet.
function computeSheetPadding(sheet: SpriteSheet): SheetPadding {
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

function drawFrame(
	ctx: CanvasRenderingContext2D,
	image: CanvasImageSource,
	frame: ResolvedSpriteAnimationFrame,
	scale: number,
	originX: number,
	originY: number
) {
	const {sprite, mirrorX, mirrorY} = frame;
	const w = sprite.width * scale;
	const h = sprite.height * scale;
	// offsets are applied in art-space: each one travels with the sprite
	// under mirroring on its own axis, so e.g. walk_right renders as the
	// screen-space mirror of walk_left rather than bobbing in the same
	// direction. a single setTransform handles any combination of axis flips
	// by anchoring the matrix at the far edge of each mirrored axis and
	// drawing at the local origin.
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
const SHADOW_SQUISH_Y = 0.6;
const SHADOW_OFFSET_X_PX = 3;
const SHADOW_OFFSET_Y_PX = 1;
const SHADOW_ALPHA = 0.35;

function drawShadow(
	ctx: CanvasRenderingContext2D,
	image: CanvasImageSource,
	frame: ResolvedSpriteAnimationFrame,
	scale: number,
	originX: number,
	originY: number
) {
	const {sprite, mirrorX, mirrorY} = frame;
	const w = sprite.width * scale;
	const h = sprite.height * scale;
	const dx = originX + (sprite.offsetX ?? 0) * (mirrorX ? -1 : 1) * scale;
	const dy = originY + (sprite.offsetY ?? 0) * (mirrorY ? -1 : 1) * scale;
	// match drawFrame's mirror handling, then squish on Y around the sprite's
	// bottom edge so the flattened silhouette stays anchored to the feet.
	const sx = mirrorX ? -1 : 1;
	const sy = (mirrorY ? -1 : 1) * SHADOW_SQUISH_Y;
	const tx = (mirrorX ? dx + w : dx) + SHADOW_OFFSET_X_PX * scale;
	const ty = (mirrorY ? dy + h : dy + h * (1 - SHADOW_SQUISH_Y)) + SHADOW_OFFSET_Y_PX * scale;
	ctx.setTransform(sx, 0, 0, sy, tx, ty);
	// brightness(0) collapses rgb to black while preserving the sprite's alpha
	// mask, giving a silhouette without needing an offscreen tint pass.
	ctx.filter = "brightness(0)";
	ctx.globalAlpha = SHADOW_ALPHA;
	ctx.drawImage(image, sprite.x, sprite.y, sprite.width, sprite.height, 0, 0, w, h);
	ctx.globalAlpha = 1;
	ctx.filter = "none";
}

type SpriteCanvasProps = {
	sprite: SpriteAsset;
	scale: number;
	animation?: SpriteAnimation;
	paletteSwap?: SpritePalette;
	shadow?: boolean;
	className?: string;
};

// draws a sprite animation onto a canvas, ticking frames via rAF and
// flipping horizontally when the active frame is mirrored. when no
// animation is supplied the first sheet entry is painted once.
export function SpriteCanvas({
	sprite,
	scale,
	animation,
	paletteSwap,
	shadow,
	className,
}: SpriteCanvasProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const image = useSpriteImage(sprite.imageUrl);
	const sheet = sprite.sheet;
	const baseSprite = sheet[0];
	const padding = useMemo(() => computeSheetPadding(sheet), [sheet]);
	const colorMap = useMemo(
		() => (sprite.palette && paletteSwap ? buildColorMap(sprite.palette, paletteSwap) : null),
		[sprite.palette, paletteSwap]
	);
	const recolored = useMemo(
		() =>
			image && colorMap && Object.keys(colorMap).length > 0
				? recolorImage(image, colorMap)
				: null,
		[image, colorMap]
	);
	const source: CanvasImageSource | null = recolored ?? image;
	const shadowMarginX = shadow ? SHADOW_OFFSET_X_PX * scale : 0;
	const shadowMarginY = shadow ? SHADOW_OFFSET_Y_PX * scale : 0;
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || !source || !baseSprite) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		const originX = padding.x * scale + shadowMarginX;
		const originY = padding.y * scale;
		ctx.imageSmoothingEnabled = false;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		if (!animation) {
			const frame = {sprite: baseSprite, mirrorX: false, mirrorY: false};
			if (shadow) drawShadow(ctx, source, frame, scale, originX, originY);
			drawFrame(ctx, source, frame, scale, originX, originY);
			return;
		}
		// a cancellation flag (rather than cancelAnimationFrame) means an
		// already-queued tick that fires after cleanup just returns instead
		// of trying to draw and re-schedule itself. that avoids a race where
		// the old loop's pending frame could land between react flushing our
		// cleanup and the browser honouring the cancel, freezing the canvas
		// on the previous animation's final frame.
		let cancelled = false;
		// first-tick anchor: deriving the phase from each animation's own
		// start timestamp keeps frame 0 visible immediately when the prop
		// changes, instead of inheriting the previous animation's phase.
		let start = -1;
		const tick = (now: number) => {
			if (cancelled) return;
			if (start < 0) start = now;
			const frame = getAnimationFrame(sheet, animation, now - start);
			ctx.imageSmoothingEnabled = false;
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			if (frame) {
				if (shadow) drawShadow(ctx, source, frame, scale, originX, originY);
				drawFrame(ctx, source, frame, scale, originX, originY);
			}
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
		return () => {
			cancelled = true;
		};
	}, [source, baseSprite, scale, animation, sheet, padding, shadow, shadowMarginX]);
	if (!baseSprite) return null;
	// shadow extends past the sprite's right/bottom edges; pad both sides on X
	// (kept symmetric to avoid layout drift between shadowed and unshadowed
	// instances) and only the bottom on Y. drawing origin is shifted right by
	// the left margin so the sprite stays centred within the extended canvas.
	return (
		<canvas
			ref={canvasRef}
			width={(baseSprite.width + padding.x * 2) * scale + shadowMarginX * 2}
			height={(baseSprite.height + padding.y * 2) * scale + shadowMarginY}
			className={className}
			style={{imageRendering: "pixelated"}}
		/>
	);
}
