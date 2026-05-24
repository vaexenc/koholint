import type {SpriteSheetData} from "../types";

export type AvatarAnimationFrame = {
	spriteIndex: number;
	mirrorX?: boolean;
	mirrorY?: boolean;
};

export type AvatarAnimation = {
	frames: AvatarAnimationFrame[];
	frameDurationMs: number;
};

// the original 4-direction stand + walk set shared by avatars that follow the
// classic gb link sheet layout (one row, indices 0-3, left/right mirrored).
export type ClassicAvatarAnimationName =
	| "stand_down"
	| "stand_up"
	| "stand_left"
	| "stand_right"
	| "walk_down"
	| "walk_up"
	| "walk_left"
	| "walk_right";

const WALK_FRAME_MS = 150;

export const CLASSIC_AVATAR_ANIMATIONS: Record<ClassicAvatarAnimationName, AvatarAnimation> = {
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

export const CLASSIC_AVATAR_ANIMATION_NAMES = Object.keys(
	CLASSIC_AVATAR_ANIMATIONS
) as ClassicAvatarAnimationName[];

export type ResolvedAvatarAnimationFrame = {
	sprite: SpriteSheetData[number];
	mirrorX: boolean;
	mirrorY: boolean;
};

// resolves an (animation, elapsed-time) pair to the concrete sheet entry and
// mirror flags the renderer should draw this tick. returns null when the
// animation references a sprite index that the sheet doesn't define.
export function getAnimationFrame(
	sheet: SpriteSheetData,
	animation: AvatarAnimation,
	elapsedMs: number
): ResolvedAvatarAnimationFrame | null {
	const frames = animation.frames;
	if (frames.length === 0) return null;
	const frameIndex = Math.floor(elapsedMs / animation.frameDurationMs) % frames.length;
	const frame = frames[frameIndex];
	const sprite = sheet.find((s) => s.index === frame.spriteIndex);
	if (!sprite) return null;
	return {sprite, mirrorX: frame.mirrorX ?? false, mirrorY: frame.mirrorY ?? false};
}
