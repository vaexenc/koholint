import {loadImage} from "@/client/lib/imageCache";
import {
	computeSheetPadding,
	drawSpriteFrame,
	drawSpriteShadow,
	resolveSpriteSource,
	silhouetteFor,
	SPRITE_SHADOW_OFFSET_X_PX,
	spriteCanvasSize,
} from "@/client/sprites";
import {getAnimationFrame, type ResolvedSpriteAnimationFrame} from "@/shared/sprites/animations";
import {sheetFootprint} from "@/shared/sprites/sheet";
import type {SpriteAnimation, SpriteAsset, SpritePalette} from "@/shared/sprites/types";
import {useEffect, useMemo, useRef, useState} from "react";

function useSpriteImage(url: string): HTMLImageElement | null {
	const [img, setImg] = useState<HTMLImageElement | null>(null);
	useEffect(() => {
		let cancelled = false;
		loadImage(url)
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
	const source = useMemo(
		() => (image ? resolveSpriteSource(image, sprite, paletteSwap) : null),
		[image, sprite, paletteSwap]
	);
	const shadowMarginX = shadow ? SPRITE_SHADOW_OFFSET_X_PX * scale : 0;
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || !source || !baseSprite) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		const originX = padding.x * scale + shadowMarginX;
		const originY = padding.top * scale;
		// the one draw both paths go through, so a still preview and an animating
		// one can't end up composed differently — they differ only in which frame
		// they hand over, and how often.
		const paint = (frame: ResolvedSpriteAnimationFrame | null) => {
			ctx.imageSmoothingEnabled = false;
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			if (!frame) return;
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
		};
		if (!animation) {
			paint({sprite: baseSprite, mirrorX: false, mirrorY: false});
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
			paint(getAnimationFrame(sheet, animation, now - start));
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
