import {rowSheet} from "@/shared/sprites/sheet";
import type {SpriteAsset} from "@/shared/sprites/types";

export const BoarblinSpriteAsset: SpriteAsset = {
	imageUrl: "/images/sprites/boarblin.png",
	sheet: rowSheet(4),
	palette: {
		primary: ["#1984ff"],
		skin: ["#ffbd8c"],
	},
};
