import {rowSheet} from "@/sprites/sheet";
import type {SpriteAsset} from "@/types";

export const BoarblinSpriteAsset: SpriteAsset = {
	imageUrl: "/images/sprites/boarblin.png",
	sheet: rowSheet(4),
	palette: {
		primary: ["#1984ff"],
		skin: ["#ffbd8c"],
	},
};
