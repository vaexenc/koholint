import {rowSheet} from "@/sprites/sheet";
import type {CharacterAnimationSet, SpriteAsset} from "@/types";

// 325ms per frame keeps the 650ms float cycle an exact divisor of the walk
// phase wrap (see ANIM_PHASE_WRAP_MS), so long walks never pop mid-cycle.
const FLOAT_FRAME_MS = 325;

// frame 0 is the idle pose, both frames alternate while moving. the art faces
// left, so facing up or right mirrors the same pair.
const GHINI_STAND = {frames: [{spriteIndex: 0}], frameDurationMs: FLOAT_FRAME_MS};
const GHINI_WALK = {
	frames: [{spriteIndex: 0}, {spriteIndex: 1}],
	frameDurationMs: FLOAT_FRAME_MS,
};
const GHINI_STAND_MIRRORED = {
	frames: [{spriteIndex: 0, mirrorX: true}],
	frameDurationMs: FLOAT_FRAME_MS,
};
const GHINI_WALK_MIRRORED = {
	frames: [
		{spriteIndex: 0, mirrorX: true},
		{spriteIndex: 1, mirrorX: true},
	],
	frameDurationMs: FLOAT_FRAME_MS,
};

const GHINI_ANIMATIONS: CharacterAnimationSet = {
	stand_down: GHINI_STAND,
	stand_up: GHINI_STAND_MIRRORED,
	stand_left: GHINI_STAND,
	stand_right: GHINI_STAND_MIRRORED,
	walk_down: GHINI_WALK,
	walk_up: GHINI_WALK_MIRRORED,
	walk_left: GHINI_WALK,
	walk_right: GHINI_WALK_MIRRORED,
};

export const GhiniSpriteAsset: SpriteAsset = {
	imageUrl: "/images/sprites/ghini.png",
	sheet: rowSheet(2),
	palette: {
		primary: ["#ff0829"],
		skin: ["#ffbd8c"],
	},
	animations: GHINI_ANIMATIONS,
};
