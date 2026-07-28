import {rowSheet} from "@/shared/sprites/sheet";
import type {SpriteAsset} from "@/shared/sprites/types";

export const DarknutSpriteAsset: SpriteAsset = {
	imageUrl: "/images/sprites/darknut.png",
	sheet: rowSheet(4),
	palette: {
		primary: ["#1984ff"],
		skin: ["#ffbd8c"],
	},
};
