import {
	CLASSIC_CHARACTER_ANIMATIONS,
	getAnimationFrame,
	type ClassicCharacterAnimationName,
} from "@/sprites/animations";
import {drawSpriteFrame, drawSpriteShadow} from "@/sprites/draw";
import {buildColorMap, recolorImage} from "@/sprites/paletteSwap";
import {characterAabb, type BasicCharacter} from "./character";
import {isSwimTile} from "./terrain";
import type {EntityId} from "./types";
import type {World} from "./world";

// water line sits a fixed fraction up the sprite; the sprite itself bobs
// vertically by ±SWIM_BOB_AMP_PX so the visible portion above the line grows
// and shrinks as the character rises and sinks. clip padding generously
// covers per-frame sprite offsets so mirrored or jittered poses still draw
// their full top half.
const SWIM_CUT_FRACTION = 0.3;
const SWIM_BOB_AMP_PX = 1.5;
const SWIM_BOB_HZ = 0.7;
const SWIM_CLIP_PAD_PX = 16;

type CharacterImage = {
	readonly source: CanvasImageSource;
};

// owns image loading + palette swapping so the world renderer stays a pure
// per-frame draw call. characters added after construction are picked up
// lazily by ensureLoaded(); the first frame after they appear they simply
// don't render, which avoids a sync await in the render path.
export class CharacterRenderer {
	private images = new Map<EntityId, CharacterImage>();
	private loading = new Set<EntityId>();

	async ensureLoaded(characters: Iterable<BasicCharacter>): Promise<void> {
		const pending: Promise<void>[] = [];
		for (const char of characters) {
			if (this.images.has(char.id) || this.loading.has(char.id)) continue;
			this.loading.add(char.id);
			pending.push(this.loadOne(char));
		}
		await Promise.all(pending);
	}

	// alpha is the fraction of the way from the previous tick state to the
	// current one (see GameClock.getInterpolationAlpha). pass 1 to render the
	// authoritative current state with no smoothing.
	drawAll(
		ctx: CanvasRenderingContext2D,
		world: World,
		drawShadows: boolean,
		alpha: number = 1
	): void {
		// precompute swim state so the sort can use the visual feet (water
		// line) rather than the geometric bottom of the sprite. without this a
		// swimmer would sort by their submerged feet and end up under nearby
		// non-swimmers whose feet are slightly above the water line.
		const drawables = [...world.characters.values()].map((char) => ({
			char,
			swimming: world.terrain ? isSwimTile(world.terrain, characterAabb(char)) : false,
		}));
		drawables.sort(
			(a, b) =>
				visualFeetY(a.char, alpha, a.swimming) - visualFeetY(b.char, alpha, b.swimming)
		);
		for (const d of drawables) this.drawCharacter(ctx, d.char, drawShadows, alpha, d.swimming);
	}

	private drawCharacter(
		ctx: CanvasRenderingContext2D,
		char: BasicCharacter,
		drawShadows: boolean,
		alpha: number,
		swimming: boolean
	): void {
		const entry = this.images.get(char.id);
		if (!entry) return;
		const animation = CLASSIC_CHARACTER_ANIMATIONS[pickAnimationName(char)];
		const frame = getAnimationFrame(char.sprite.sheet, animation, char.animTimeMs);
		if (!frame) return;
		const x = renderX(char, alpha);
		const y = renderY(char, alpha);
		// jump offset lifts the sprite only; the shadow stays anchored to the
		// ground projection so it reads as a hop rather than a teleport.
		const jumpOffset = char.prevJumpOffsetY + (char.jumpOffsetY - char.prevJumpOffsetY) * alpha;
		if (swimming) {
			// water line is fixed; bobbing the sprite up and down makes the
			// visible portion above the line grow and shrink naturally. skip
			// the shadow since the character reads as floating, not standing.
			const bob = swimBobOffset(performance.now());
			const waterLineY = y + char.spriteHeight * (1 - SWIM_CUT_FRACTION);
			const clipTop = y - SWIM_CLIP_PAD_PX - SWIM_BOB_AMP_PX;
			ctx.save();
			// reset to identity before clipping. drawSpriteFrame/Shadow leave
			// the prior character's (possibly mirrored) transform on the ctx,
			// which would otherwise warp the clip rect off the sprite and
			// hide the swimmer entirely.
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.beginPath();
			ctx.rect(
				x - SWIM_CLIP_PAD_PX,
				clipTop,
				char.spriteWidth + SWIM_CLIP_PAD_PX * 2,
				waterLineY - clipTop
			);
			ctx.clip();
			drawSpriteFrame(ctx, entry.source, frame, 1, x, y - bob);
			ctx.restore();
			return;
		}
		if (drawShadows) drawSpriteShadow(ctx, entry.source, frame, 1, x, y);
		drawSpriteFrame(ctx, entry.source, frame, 1, x, y - jumpOffset);
	}

	private async loadOne(char: BasicCharacter): Promise<void> {
		try {
			const image = await loadImage(char.sprite.imageUrl);
			let source: CanvasImageSource = image;
			if (char.sprite.palette && char.paletteSwap) {
				const colorMap = buildColorMap(char.sprite.palette, char.paletteSwap);
				if (colorMap.size > 0) source = recolorImage(image, colorMap);
			}
			this.images.set(char.id, {source});
		} finally {
			this.loading.delete(char.id);
		}
	}
}

function pickAnimationName(char: BasicCharacter): ClassicCharacterAnimationName {
	const prefix: "walk" | "stand" = char.walking ? "walk" : "stand";
	return `${prefix}_${char.facing}`;
}

function swimBobOffset(timeMs: number): number {
	const phase = (timeMs / 1000) * SWIM_BOB_HZ * Math.PI * 2;
	return SWIM_BOB_AMP_PX * Math.sin(phase);
}

function renderX(char: BasicCharacter, alpha: number): number {
	return char.prevX + (char.x - char.prevX) * alpha;
}

function renderY(char: BasicCharacter, alpha: number): number {
	return char.prevY + (char.y - char.prevY) * alpha;
}

function visualFeetY(char: BasicCharacter, alpha: number, swimming: boolean): number {
	const y = renderY(char, alpha);
	const footFraction = swimming ? 1 - SWIM_CUT_FRACTION : 1;
	return y + char.spriteHeight * footFraction;
}

function loadImage(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.decoding = "async";
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error(`failed to load sprite image: ${url}`));
		image.src = url;
	});
}
