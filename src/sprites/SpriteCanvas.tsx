import {useEffect, useMemo, useRef, useState} from "react";
import type {SpriteAsset, SpriteSheet} from "../types";
import {
	getAnimationFrame,
	type ResolvedSpriteAnimationFrame,
	type SpriteAnimation,
} from "./animations";

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
	image: HTMLImageElement,
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

type SpriteCanvasProps = {
	sprite: SpriteAsset;
	scale: number;
	animation?: SpriteAnimation;
	className?: string;
};

// draws a sprite animation onto a canvas, ticking frames via rAF and
// flipping horizontally when the active frame is mirrored. when no
// animation is supplied the first sheet entry is painted once.
export function SpriteCanvas({sprite, scale, animation, className}: SpriteCanvasProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const image = useSpriteImage(sprite.imageUrl);
	const sheet = sprite.sheet;
	const baseSprite = sheet[0];
	const padding = useMemo(() => computeSheetPadding(sheet), [sheet]);
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || !image || !baseSprite) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		const originX = padding.x * scale;
		const originY = padding.y * scale;
		ctx.imageSmoothingEnabled = false;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		if (!animation) {
			drawFrame(
				ctx,
				image,
				{sprite: baseSprite, mirrorX: false, mirrorY: false},
				scale,
				originX,
				originY
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
			if (frame) drawFrame(ctx, image, frame, scale, originX, originY);
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
		return () => {
			cancelled = true;
		};
	}, [image, baseSprite, scale, animation, sheet, padding]);
	if (!baseSprite) return null;
	return (
		<canvas
			ref={canvasRef}
			width={(baseSprite.width + padding.x * 2) * scale}
			height={(baseSprite.height + padding.y * 2) * scale}
			className={className}
			style={{imageRendering: "pixelated"}}
		/>
	);
}
