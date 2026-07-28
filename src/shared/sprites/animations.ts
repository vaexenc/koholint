import type {CharacterAnimationSet, SpriteAnimation, SpriteSheet} from "@/shared/sprites/types";

const WALK_FRAME_MS = 150;

// the original 4-direction stand + walk set shared by characters that follow
// the classic gb link sheet layout (one row, indices 0-3, left/right mirrored).
export const CLASSIC_CHARACTER_ANIMATIONS: CharacterAnimationSet = {
	stand_down: {
		frames: [{spriteIndex: 0}],
		frameDurationMs: WALK_FRAME_MS,
	},
	stand_up: {
		frames: [{spriteIndex: 1}],
		frameDurationMs: WALK_FRAME_MS,
	},
	stand_left: {
		frames: [{spriteIndex: 2}],
		frameDurationMs: WALK_FRAME_MS,
	},
	stand_right: {
		frames: [{spriteIndex: 2, mirrorX: true}],
		frameDurationMs: WALK_FRAME_MS,
	},
	walk_down: {
		frames: [{spriteIndex: 0}, {spriteIndex: 0, mirrorX: true}],
		frameDurationMs: WALK_FRAME_MS,
	},
	walk_up: {
		frames: [{spriteIndex: 1}, {spriteIndex: 1, mirrorX: true}],
		frameDurationMs: WALK_FRAME_MS,
	},
	walk_left: {
		frames: [{spriteIndex: 2}, {spriteIndex: 3}],
		frameDurationMs: WALK_FRAME_MS,
	},
	walk_right: {
		frames: [
			{spriteIndex: 2, mirrorX: true},
			{spriteIndex: 3, mirrorX: true},
		],
		frameDurationMs: WALK_FRAME_MS,
	},
};

// full walk-cycle duration. every walk animation above is two frames held for
// WALK_FRAME_MS each, so the walk phase repeats on this period. exported so the
// simulation can keep its phase accumulator bounded to a whole number of cycles
// (an unbounded accumulator overflows the snapshot's one-byte phase encoding).
export const WALK_CYCLE_MS = WALK_FRAME_MS * 2;

export type ResolvedSpriteAnimationFrame = {
	sprite: SpriteSheet[number];
	mirrorX: boolean;
	mirrorY: boolean;
};

// resolves an (animation, elapsed-time) pair to the concrete sheet entry and
// mirror flags the renderer should draw this tick. returns null when the
// animation references a sprite index that the sheet doesn't define.
export function getAnimationFrame(
	sheet: SpriteSheet,
	animation: SpriteAnimation,
	elapsedMs: number
): ResolvedSpriteAnimationFrame | null {
	const frames = animation.frames;
	if (frames.length === 0) return null;
	const frameIndex = Math.floor(elapsedMs / animation.frameDurationMs) % frames.length;
	const frame = frames[frameIndex];
	const sprite = sheet.find((s) => s.index === frame.spriteIndex);
	if (!sprite) return null;
	return {sprite, mirrorX: frame.mirrorX ?? false, mirrorY: frame.mirrorY ?? false};
}
