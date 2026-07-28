import {sheetFootprint} from "@/shared/sprites/sheet";
import type {SpriteAsset} from "@/shared/sprites/types";
import {computeSheetPadding, SPRITE_SHADOW_OFFSET_X_PX, SPRITE_SHADOW_OFFSET_Y_PX} from "./draw";

// the canvas box a sprite renders into: logical footprint plus per-side padding
// and shadow margins. sprite geometry rather than component state, so the three
// surfaces that need it — the live <SpriteCanvas>, the data-url icon cache, and
// the picker's fixed preview slot — all derive it from here instead of from
// whichever of them happened to declare it.
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
