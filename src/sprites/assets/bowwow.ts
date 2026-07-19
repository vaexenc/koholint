import {rowSheet} from "@/sprites/sheet";
import type {CharacterAnimationSet, SpriteAsset} from "@/types";

const CHOMP_FRAME_MS = 150;

// sheet layout differs from the classic one: 0 front, 1 front chomping,
// 2 side, 3 side chomping, 4 back.
const BOWWOW_ANIMATIONS: CharacterAnimationSet = {
	stand_down: {frames: [{spriteIndex: 0}], frameDurationMs: CHOMP_FRAME_MS},
	stand_up: {frames: [{spriteIndex: 4}], frameDurationMs: CHOMP_FRAME_MS},
	stand_left: {frames: [{spriteIndex: 2}], frameDurationMs: CHOMP_FRAME_MS},
	stand_right: {frames: [{spriteIndex: 2, mirrorX: true}], frameDurationMs: CHOMP_FRAME_MS},
	walk_down: {frames: [{spriteIndex: 0}, {spriteIndex: 1}], frameDurationMs: CHOMP_FRAME_MS},
	walk_up: {
		frames: [{spriteIndex: 4}, {spriteIndex: 4, mirrorX: true}],
		frameDurationMs: CHOMP_FRAME_MS,
	},
	walk_left: {frames: [{spriteIndex: 2}, {spriteIndex: 3}], frameDurationMs: CHOMP_FRAME_MS},
	walk_right: {
		frames: [
			{spriteIndex: 2, mirrorX: true},
			{spriteIndex: 3, mirrorX: true},
		],
		frameDurationMs: CHOMP_FRAME_MS,
	},
};

export const BowwowSpriteAsset: SpriteAsset = {
	imageUrl: "/images/sprites/bowwow.png",
	sheet: rowSheet(5),
	palette: {
		primary: ["#1984ff"],
		skin: ["#ffbd8c"],
	},
	animations: BOWWOW_ANIMATIONS,
};
