import {getAnimationFrame, type SpriteAnimation} from "@/sprites/animations";
import {
	computeSheetPadding,
	drawSpriteFrame,
	drawSpriteShadow,
	SPRITE_SHADOW_OFFSET_X_PX,
	SPRITE_SHADOW_OFFSET_Y_PX,
} from "@/sprites/draw";
import {buildColorMap, recolorImage} from "@/sprites/paletteSwap";
import type {SpriteAsset, SpritePalette} from "@/types";
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
	const shadowMarginX = shadow ? SPRITE_SHADOW_OFFSET_X_PX * scale : 0;
	const shadowMarginY = shadow ? SPRITE_SHADOW_OFFSET_Y_PX * scale : 0;
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
			if (shadow) drawSpriteShadow(ctx, source, frame, scale, originX, originY);
			drawSpriteFrame(ctx, source, frame, scale, originX, originY);
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
				if (shadow) drawSpriteShadow(ctx, source, frame, scale, originX, originY);
				drawSpriteFrame(ctx, source, frame, scale, originX, originY);
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
