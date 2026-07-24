import {getAnimationFrame} from "@/sprites/animations";
import {
	computeSheetPadding,
	drawSpriteFrame,
	drawSpriteShadow,
	silhouetteFor,
	SPRITE_SHADOW_OFFSET_X_PX,
	SPRITE_SHADOW_OFFSET_Y_PX,
} from "@/sprites/draw";
import {loadSpriteImage} from "@/sprites/imageCache";
import {recolorImageCached} from "@/sprites/paletteSwap";
import {sheetFootprint} from "@/sprites/sheet";
import type {SpriteAnimation, SpriteAsset, SpritePalette} from "@/types";
import {useEffect, useMemo, useRef, useState} from "react";

function useSpriteImage(url: string): HTMLImageElement | null {
	const [img, setImg] = useState<HTMLImageElement | null>(null);
	useEffect(() => {
		let cancelled = false;
		loadSpriteImage(url)
			.then((image) => {
				if (!cancelled) setImg(image);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [url]);
	return img;
}

// the canvas box a sprite renders into: logical footprint plus per-side
// padding and shadow margins. exported so surfaces can reserve a fixed slot
// (e.g. the picker preview) that fits any sprite without layout shift.
export function spriteCanvasSize(
	sprite: SpriteAsset,
	scale: number,
	shadow = false
): {width: number; height: number} {
	const padding = computeSheetPadding(sprite.sheet);
	const footprint = sheetFootprint(sprite.sheet);
	const shadowMarginX = shadow ? SPRITE_SHADOW_OFFSET_X_PX * scale : 0;
	const shadowMarginY = shadow ? SPRITE_SHADOW_OFFSET_Y_PX * scale : 0;
	return {
		width: (footprint.width + padding.x * 2) * scale + shadowMarginX * 2,
		height: (footprint.height + padding.top + padding.bottom) * scale + shadowMarginY,
	};
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
	const footprint = useMemo(() => sheetFootprint(sheet), [sheet]);
	const recolored = useMemo(
		() =>
			image && sprite.palette && paletteSwap
				? recolorImageCached(image, sprite.palette, paletteSwap)
				: null,
		[image, sprite.palette, paletteSwap]
	);
	const source: CanvasImageSource | null = recolored ?? image;
	const shadowMarginX = shadow ? SPRITE_SHADOW_OFFSET_X_PX * scale : 0;
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || !source || !baseSprite) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		const originX = padding.x * scale + shadowMarginX;
		const originY = padding.top * scale;
		ctx.imageSmoothingEnabled = false;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		if (!animation) {
			const frame = {sprite: baseSprite, mirrorX: false, mirrorY: false};
			if (shadow)
				drawSpriteShadow(
					ctx,
					silhouetteFor(source),
					frame,
					scale,
					originX,
					originY,
					footprint.width,
					footprint.height
				);
			drawSpriteFrame(
				ctx,
				source,
				frame,
				scale,
				originX,
				originY,
				baseSprite.width,
				baseSprite.height
			);
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
				if (shadow)
					drawSpriteShadow(
						ctx,
						silhouetteFor(source),
						frame,
						scale,
						originX,
						originY,
						footprint.width,
						footprint.height
					);
				drawSpriteFrame(
					ctx,
					source,
					frame,
					scale,
					originX,
					originY,
					footprint.width,
					footprint.height
				);
			}
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
		return () => {
			cancelled = true;
		};
	}, [source, baseSprite, scale, animation, sheet, padding, footprint, shadow, shadowMarginX]);
	if (!baseSprite) return null;
	// canvas wraps the logical footprint plus per-side padding, so the feet
	// line sits a fixed distance from the canvas bottom for every sheet.
	// shadow extends past the sprite's right/bottom edges; pad both sides on X
	// (kept symmetric to avoid layout drift between shadowed and unshadowed
	// instances) and only the bottom on Y. drawing origin is shifted right by
	// the left margin so the sprite stays centred within the extended canvas.
	const size = spriteCanvasSize(sprite, scale, shadow);
	return (
		<canvas
			ref={canvasRef}
			width={size.width}
			height={size.height}
			className={className}
			style={{imageRendering: "pixelated"}}
		/>
	);
}
