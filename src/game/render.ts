import {
	CLASSIC_CHARACTER_ANIMATIONS,
	getAnimationFrame,
	type ClassicCharacterAnimationName,
} from "@/sprites/animations";
import {drawSpriteFrame, drawSpriteShadow} from "@/sprites/draw";
import {buildColorMap, recolorImage} from "@/sprites/paletteSwap";
import {characterAabb, type BasicCharacter} from "./character";
import {lerp} from "./math";
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
// sinks the sprite a few px below its ground-render position so a character
// stepping from land to water visibly drops into the water instead of staying
// at the same screen height. water line is unaffected.
const SWIM_SINK_PX = 3;

type CharacterImage = {
	readonly source: CanvasImageSource;
};

// owns image loading + palette swapping so the world renderer stays a pure
// per-frame draw call. characters added after construction are picked up
// lazily by ensureLoaded(); the first frame after they appear they simply
// don't render, which avoids a sync await in the render path.
export class CharacterRenderer {
	private images = new Map<EntityId, CharacterImage>();
	// per-id token for the in-flight load. invalidate() drops the entry so
	// any older load that resolves later sees a missing/different token and
	// discards its result, preventing a stale sprite from clobbering the
	// freshly-requested one when appearance changes mid-flight.
	private loading = new Map<EntityId, number>();
	private nextToken = 0;

	async ensureLoaded(characters: Iterable<BasicCharacter>): Promise<void> {
		const pending: Promise<void>[] = [];
		for (const char of characters) {
			if (this.images.has(char.id) || this.loading.has(char.id)) continue;
			const token = ++this.nextToken;
			this.loading.set(char.id, token);
			pending.push(this.loadOne(char, token));
		}
		await Promise.all(pending);
	}

	// drop the cached image for `id` so the next ensureLoaded() reloads it
	// against the character's current sprite/paletteSwap. used when callers
	// mutate a character's appearance in place.
	invalidate(id: EntityId): void {
		this.images.delete(id);
		this.loading.delete(id);
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
			swimming: isSwimming(world, char),
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
		const jumpOffset = lerp(char.prevJumpOffsetY, char.jumpOffsetY, alpha);
		if (swimming) {
			// water line is fixed; bobbing the sprite up and down makes the
			// visible portion above the line grow and shrink naturally. skip
			// the shadow since the character reads as floating, not standing.
			const bob = swimBobOffset(performance.now());
			const sunkY = y + SWIM_SINK_PX;
			const waterLineY = sunkY + char.spriteHeight * (1 - SWIM_CUT_FRACTION);
			const clipTop = sunkY - SWIM_CLIP_PAD_PX - SWIM_BOB_AMP_PX;
			ctx.save();
			ctx.beginPath();
			ctx.rect(
				x - SWIM_CLIP_PAD_PX,
				clipTop,
				char.spriteWidth + SWIM_CLIP_PAD_PX * 2,
				waterLineY - clipTop
			);
			ctx.clip();
			drawSpriteFrame(ctx, entry.source, frame, 1, x, sunkY - bob);
			ctx.restore();
			return;
		}
		if (drawShadows) drawSpriteShadow(ctx, entry.source, frame, 1, x, y);
		drawSpriteFrame(ctx, entry.source, frame, 1, x, y - jumpOffset);
	}

	private async loadOne(char: BasicCharacter, token: number): Promise<void> {
		try {
			const image = await loadImage(char.sprite.imageUrl);
			// invalidate() or a newer ensureLoaded() may have superseded us
			// while loadImage was pending; drop the stale result so it can't
			// overwrite a fresher sprite.
			if (this.loading.get(char.id) !== token) return;
			let source: CanvasImageSource = image;
			if (char.sprite.palette && char.paletteSwap) {
				const colorMap = buildColorMap(char.sprite.palette, char.paletteSwap);
				if (colorMap.size > 0) source = recolorImage(image, colorMap);
			}
			this.images.set(char.id, {source});
		} finally {
			if (this.loading.get(char.id) === token) this.loading.delete(char.id);
		}
	}
}

function pickAnimationName(char: BasicCharacter): ClassicCharacterAnimationName {
	const prefix: "walk" | "stand" = char.walking ? "walk" : "stand";
	return `${prefix}_${char.facing}`;
}

// an airborne body never draws the swim pose, even while its ground projection
// crosses water (e.g. hopping a cliff channel). remote characters don't carry
// jump state — their lifted arc arrives via jumpOffsetY — so the offset pair
// doubles as the airborne signal for them (and for teleport rise/fall).
function isSwimming(world: World, char: BasicCharacter): boolean {
	if (!world.terrain) return false;
	if (char.jump || char.jumpOffsetY > 0 || char.prevJumpOffsetY > 0) return false;
	return isSwimTile(world.terrain, characterAabb(char));
}

function swimBobOffset(timeMs: number): number {
	const phase = (timeMs / 1000) * SWIM_BOB_HZ * Math.PI * 2;
	return SWIM_BOB_AMP_PX * Math.sin(phase);
}

function renderX(char: BasicCharacter, alpha: number): number {
	return lerp(char.prevX, char.x, alpha);
}

function renderY(char: BasicCharacter, alpha: number): number {
	return lerp(char.prevY, char.y, alpha);
}

function visualFeetY(char: BasicCharacter, alpha: number, swimming: boolean): number {
	const y = renderY(char, alpha);
	if (!swimming) return y + char.spriteHeight;
	return y + SWIM_SINK_PX + char.spriteHeight * (1 - SWIM_CUT_FRACTION);
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
