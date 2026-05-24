import {
	CLASSIC_CHARACTER_ANIMATIONS,
	getAnimationFrame,
	type ClassicCharacterAnimationName,
} from "@/sprites/animations";
import {drawSpriteFrame, drawSpriteShadow} from "@/sprites/draw";
import {buildColorMap, recolorImage} from "@/sprites/paletteSwap";
import type {BasicCharacter} from "./character";
import type {EntityId} from "./types";
import type {World} from "./world";

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
		// sort by interpolated feet-y so the depth order matches what the
		// player actually sees, not the tick-aligned positions.
		const ordered = [...world.characters.values()].sort(
			(a, b) => renderY(a, alpha) + a.spriteHeight - (renderY(b, alpha) + b.spriteHeight)
		);
		for (const char of ordered) this.drawCharacter(ctx, char, drawShadows, alpha);
	}

	private drawCharacter(
		ctx: CanvasRenderingContext2D,
		char: BasicCharacter,
		drawShadows: boolean,
		alpha: number
	): void {
		const entry = this.images.get(char.id);
		if (!entry) return;
		const animation = CLASSIC_CHARACTER_ANIMATIONS[pickAnimationName(char)];
		const frame = getAnimationFrame(char.sprite.sheet, animation, char.animTimeMs);
		if (!frame) return;
		const x = renderX(char, alpha);
		const y = renderY(char, alpha);
		if (drawShadows) drawSpriteShadow(ctx, entry.source, frame, 1, x, y);
		drawSpriteFrame(ctx, entry.source, frame, 1, x, y);
	}

	private async loadOne(char: BasicCharacter): Promise<void> {
		try {
			const image = await loadImage(char.sprite.imageUrl);
			let source: CanvasImageSource = image;
			if (char.sprite.palette && char.paletteSwap) {
				const colorMap = buildColorMap(char.sprite.palette, char.paletteSwap);
				if (Object.keys(colorMap).length > 0) source = recolorImage(image, colorMap);
			}
			this.images.set(char.id, {source});
		} finally {
			this.loading.delete(char.id);
		}
	}
}

function pickAnimationName(char: BasicCharacter): ClassicCharacterAnimationName {
	const prefix = char.walking ? "walk" : "stand";
	return `${prefix}_${char.facing}` as ClassicCharacterAnimationName;
}

function renderX(char: BasicCharacter, alpha: number): number {
	return char.prevX + (char.x - char.prevX) * alpha;
}

function renderY(char: BasicCharacter, alpha: number): number {
	return char.prevY + (char.y - char.prevY) * alpha;
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
