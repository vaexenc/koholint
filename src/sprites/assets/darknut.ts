import {rowSheet} from "@/sprites/sheet";
import type {SpriteAsset} from "@/types";

export const DarknutSpriteAsset: SpriteAsset = {
	imageUrl: "/images/sprites/darknut.png",
	sheet: rowSheet(4),
	palette: {
		primary: ["#1984ff"],
		skin: ["#ffbd8c"],
	},
};
