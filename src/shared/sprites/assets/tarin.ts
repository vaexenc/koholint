import {rowSheet} from "@/shared/sprites/sheet";
import type {SpriteAsset} from "@/shared/sprites/types";

export const TarinSpriteAsset: SpriteAsset = {
	imageUrl: "/images/sprites/tarin.png",
	sheet: rowSheet(4),
	palette: {
		primary: ["#ff0829"],
		skin: ["#ffbd8c"],
	},
};
