import {rowSheet} from "@/shared/sprites/sheet";
import type {SpriteAsset} from "@/shared/sprites/types";

// the sheet has a 5th bonus pose (index 4) that no animation references yet.
export const RalphSpriteAsset: SpriteAsset = {
	imageUrl: "/images/sprites/ralph.png",
	sheet: rowSheet(5, 16, 20),
	palette: {
		primary: ["#1984ff"],
		skin: ["#ffd68c"],
	},
};
