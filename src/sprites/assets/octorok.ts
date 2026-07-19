import {rowSheet} from "@/sprites/sheet";
import type {CharacterAnimationSet, SpriteAsset} from "@/types";

const WALK_FRAME_MS = 150;

// sheet layout differs from the classic one: 0 and 1 are the down walk pair,
// 2 and 3 the side pair. there is no up art — up reuses the down animation
// vertically mirrored.
const OCTOROK_ANIMATIONS: CharacterAnimationSet = {
	stand_down: {frames: [{spriteIndex: 0}], frameDurationMs: WALK_FRAME_MS},
	stand_up: {frames: [{spriteIndex: 0, mirrorY: true}], frameDurationMs: WALK_FRAME_MS},
	stand_left: {frames: [{spriteIndex: 2}], frameDurationMs: WALK_FRAME_MS},
	stand_right: {frames: [{spriteIndex: 2, mirrorX: true}], frameDurationMs: WALK_FRAME_MS},
	walk_down: {frames: [{spriteIndex: 0}, {spriteIndex: 1}], frameDurationMs: WALK_FRAME_MS},
	walk_up: {
		frames: [
			{spriteIndex: 0, mirrorY: true},
			{spriteIndex: 1, mirrorY: true},
		],
		frameDurationMs: WALK_FRAME_MS,
	},
	walk_left: {frames: [{spriteIndex: 2}, {spriteIndex: 3}], frameDurationMs: WALK_FRAME_MS},
	walk_right: {
		frames: [
			{spriteIndex: 2, mirrorX: true},
			{spriteIndex: 3, mirrorX: true},
		],
		frameDurationMs: WALK_FRAME_MS,
	},
};

export const OctorokSpriteAsset: SpriteAsset = {
	imageUrl: "/images/sprites/octorok.png",
	sheet: rowSheet(4),
	palette: {
		primary: ["#ff0829"],
		skin: ["#ffbd8c"],
	},
	animations: OCTOROK_ANIMATIONS,
};
