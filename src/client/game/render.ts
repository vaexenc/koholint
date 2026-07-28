import {loadImage} from "@/client/lib/imageCache";
import {
	drawSpriteFrame,
	drawSpriteShadow,
	resolveSpriteSource,
	silhouetteFor,
	type SpriteSource,
} from "@/client/sprites";
import {
	characterAabb,
	interpolatedPose,
	type BasicCharacter,
	type InterpolatedPose,
} from "@/shared/game/character";
import {isSwimTile} from "@/shared/game/terrain";
import type {World} from "@/shared/game/world";
import type {Aabb} from "@/shared/lib/rect";
import {
	CLASSIC_CHARACTER_ANIMATIONS,
	getAnimationFrame,
	type ResolvedSpriteAnimationFrame,
} from "@/shared/sprites/animations";
import type {CharacterAnimationName} from "@/shared/sprites/types";

// one character resolved for this frame: its interpolated pose and swim state,
// derived once and shared by the cull, the y-sort and the draw.
type Drawable = {
	readonly char: BasicCharacter;
	readonly pose: InterpolatedPose;
	readonly swimming: boolean;
};

// a character resolved down to what a blit needs: the palette-swapped sheet,
// this frame's cell, and the footprint to draw it into. the two draw modes take
// this rather than the character, so neither can quietly grow a dependency on
// simulation state that the other doesn't share.
type ResolvedSprite = {
	readonly source: SpriteSource;
	readonly frame: ResolvedSpriteAnimationFrame;
	readonly width: number;
	readonly height: number;
};

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

// slack around the visible rect when culling, covering everything a character
// draws outside its sprite box: the swim clip pad, the shadow's offset, and a
// jump's lift.
const CULL_MARGIN_PX = 48;

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
				this.imagesByUrl.set(url, await loadImage(url));
			});
		await Promise.all(pending);
	}

	// `view` is the visible world rect; characters outside it are skipped, so a
	// crowd spread over a large map only costs what's on screen. alpha is the
	// fraction of the way from the previous tick state to the current one (see
	// GameClock.getInterpolationAlpha). pass 1 to render the authoritative
	// current state with no smoothing.
	drawAll(
		ctx: CanvasRenderingContext2D,
		world: World,
		view: Aabb,
		drawShadows: boolean,
		alpha: number = 1
	): void {
		// the interpolated pose is resolved once per character and carried
		// through: the cull, the sort and the draw all have to agree on where the
		// sprite is this frame, and the sort would otherwise re-derive it on every
		// comparison. swim state is precomputed for the same reason, and so the
		// sort can use the visual feet (water line) rather than the geometric
		// bottom of the sprite — without it a swimmer would sort by their
		// submerged feet and end up under nearby non-swimmers whose feet sit
		// slightly above the water line.
		const drawables: Drawable[] = [];
		for (const char of world.characters.values()) {
			const pose = interpolatedPose(char, alpha);
			if (!isVisible(char, pose, view)) continue;
			drawables.push({char, pose, swimming: isSwimming(world, char)});
		}
		drawables.sort((a, b) => visualFeetY(a) - visualFeetY(b));
		for (const d of drawables) this.drawCharacter(ctx, d, drawShadows);
	}

	// resolve the sheet and this frame's cell, then hand the blit to whichever
	// mode the body is in. the two modes share this prologue and nothing after
	// it: a swimmer clips at a water line and never leaves it, a grounded body
	// lifts off a stationary shadow.
	private drawCharacter(
		ctx: CanvasRenderingContext2D,
		{char, pose, swimming}: Drawable,
		drawShadows: boolean
	): void {
		const image = this.imagesByUrl.get(char.sprite.imageUrl);
		if (!image) return;
		const animations = char.sprite.animations ?? CLASSIC_CHARACTER_ANIMATIONS;
		const animation = animations[pickAnimationName(char)];
		const frame = getAnimationFrame(char.sprite.sheet, animation, char.animTimeMs);
		if (!frame) return;
		const sprite: ResolvedSprite = {
			source: resolveSpriteSource(image, char.sprite, char.paletteSwap),
			frame,
			width: char.spriteWidth,
			height: char.spriteHeight,
		};
		if (swimming) drawSwimming(ctx, sprite, pose, drawShadows);
		else drawGrounded(ctx, sprite, pose, drawShadows);
	}
}

// sunk a few px so stepping off land visibly drops into the water, bobbing on
// the spot, and cut at a fixed water line so everything below reads as
// submerged. an airborne body never gets here (see isSwimming), so the jump
// offset has nothing to say about this pose and is deliberately ignored.
function drawSwimming(
	ctx: CanvasRenderingContext2D,
	sprite: ResolvedSprite,
	pose: InterpolatedPose,
	drawShadows: boolean
): void {
	const {x} = pose;
	const sunkY = pose.y + SWIM_SINK_PX;
	const waterLineY = sunkY + sprite.height * (1 - SWIM_CUT_FRACTION);
	const clipTop = sunkY - SWIM_CLIP_PAD_PX - SWIM_BOB_AMP_PX;
	ctx.save();
	ctx.beginPath();
	ctx.rect(
		x - SWIM_CLIP_PAD_PX,
		clipTop,
		sprite.width + SWIM_CLIP_PAD_PX * 2,
		waterLineY - clipTop
	);
	ctx.clip();
	// the shadow rides the bob welded to the body, exactly as it sits on land:
	// there is no surface beneath a swimmer for it to stay behind on, so nothing
	// here plays the part jumpOffset does on the grounded path. it is drawn
	// inside the clip because the silhouette is baked from the whole frame —
	// untrimmed it would trace the submerged legs the water line exists to hide.
	const bodyY = sunkY - swimBobOffset(performance.now());
	if (drawShadows) drawShadowOn(ctx, sprite, x, bodyY);
	drawFrameAt(ctx, sprite, x, bodyY);
	ctx.restore();
}

// feet on the ground: the jump offset lifts the sprite only, while the shadow
// stays anchored to the ground projection so a hop reads as a hop rather than a
// teleport.
function drawGrounded(
	ctx: CanvasRenderingContext2D,
	sprite: ResolvedSprite,
	pose: InterpolatedPose,
	drawShadows: boolean
): void {
	const {x, y, jumpOffset} = pose;
	if (drawShadows) drawShadowOn(ctx, sprite, x, y);
	drawFrameAt(ctx, sprite, x, y - jumpOffset);
}

function drawFrameAt(
	ctx: CanvasRenderingContext2D,
	sprite: ResolvedSprite,
	x: number,
	y: number
): void {
	drawSpriteFrame(ctx, sprite.source, sprite.frame, 1, x, y, sprite.width, sprite.height);
}

// the silhouette flattened onto whatever surface the body is resting on —
// ground underfoot, or the water a swimmer floats in. baked once per source, so
// resolving it per draw is a lookup.
function drawShadowOn(
	ctx: CanvasRenderingContext2D,
	sprite: ResolvedSprite,
	x: number,
	surfaceY: number
): void {
	drawSpriteShadow(
		ctx,
		silhouetteFor(sprite.source),
		sprite.frame,
		1,
		x,
		surfaceY,
		sprite.width,
		sprite.height
	);
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
	if (char.jump || char.jumpOffsetY > 0 || char.prevJumpOffsetY > 0) return false;
	return isSwimTile(world.grids.terrain, characterAabb(char));
}

function isVisible(char: BasicCharacter, pose: InterpolatedPose, view: Aabb): boolean {
	const {x, y} = pose;
	return (
		x + char.spriteWidth + CULL_MARGIN_PX > view.x &&
		x - CULL_MARGIN_PX < view.x + view.width &&
		y + char.spriteHeight + CULL_MARGIN_PX > view.y &&
		y - CULL_MARGIN_PX < view.y + view.height
	);
}

function swimBobOffset(timeMs: number): number {
	const phase = (timeMs / 1000) * SWIM_BOB_HZ * Math.PI * 2;
	return SWIM_BOB_AMP_PX * Math.sin(phase);
}

function visualFeetY({char, pose, swimming}: Drawable): number {
	if (!swimming) return pose.y + char.spriteHeight;
	return pose.y + SWIM_SINK_PX + char.spriteHeight * (1 - SWIM_CUT_FRACTION);
}
