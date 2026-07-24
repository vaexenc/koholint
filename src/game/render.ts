import {CLASSIC_CHARACTER_ANIMATIONS, getAnimationFrame} from "@/sprites/animations";
import {drawSpriteFrame, drawSpriteShadow, silhouetteFor, type SpriteSource} from "@/sprites/draw";
import {loadSpriteImage} from "@/sprites/imageCache";
import {recolorImageCached} from "@/sprites/paletteSwap";
import type {CharacterAnimationName} from "@/types";
import {characterAabb, type BasicCharacter} from "./character";
import {lerp} from "./math";
import {isSwimTile} from "./terrain";
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

// a character's drawable pixels: the shared decoded sheet, or the shared
// palette-swapped canvas when it wears one. both are cached per appearance
// (sheet × palette), so every character with the same look draws from the
// same pixels.
function sourceFor(image: HTMLImageElement, char: BasicCharacter): SpriteSource {
	if (!char.sprite.palette || !char.paletteSwap) return image;
	return recolorImageCached(image, char.sprite.palette, char.paletteSwap) ?? image;
}

// owns image loading + palette swapping so the world renderer stays a pure
// per-frame draw call. characters added after construction are picked up
// lazily by ensureLoaded(); the first frame after they appear they simply
// don't render, which avoids a sync await in the render path. all state is
// keyed by appearance (a fixed catalog), never by entity, so join/leave churn
// leaves nothing behind and appearance changes need no invalidation — the
// next frame simply resolves the new look.
export class CharacterRenderer {
	// sheet url -> decoded image, warmed by ensureLoaded so the draw path can
	// resolve a character's appearance synchronously.
	private readonly imagesByUrl = new Map<string, HTMLImageElement>();

	async ensureLoaded(characters: Iterable<BasicCharacter>): Promise<void> {
		const urls = new Set<string>();
		for (const char of characters) urls.add(char.sprite.imageUrl);
		const pending = [...urls]
			.filter((url) => !this.imagesByUrl.has(url))
			.map(async (url) => {
				// a failed load leaves the url absent (and evicted from the
				// image cache), so a later ensureLoaded retries it.
				this.imagesByUrl.set(url, await loadSpriteImage(url));
			});
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
		const image = this.imagesByUrl.get(char.sprite.imageUrl);
		if (!image) return;
		const source = sourceFor(image, char);
		const animations = char.sprite.animations ?? CLASSIC_CHARACTER_ANIMATIONS;
		const animation = animations[pickAnimationName(char)];
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
			drawSpriteFrame(
				ctx,
				source,
				frame,
				1,
				x,
				sunkY - bob,
				char.spriteWidth,
				char.spriteHeight
			);
			ctx.restore();
			return;
		}
		if (drawShadows)
			drawSpriteShadow(
				ctx,
				silhouetteFor(source),
				frame,
				1,
				x,
				y,
				char.spriteWidth,
				char.spriteHeight
			);
		drawSpriteFrame(
			ctx,
			source,
			frame,
			1,
			x,
			y - jumpOffset,
			char.spriteWidth,
			char.spriteHeight
		);
	}
}

function pickAnimationName(char: BasicCharacter): CharacterAnimationName {
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
