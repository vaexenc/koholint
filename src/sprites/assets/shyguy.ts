import {rowSheet} from "@/sprites/sheet";
import type {SpriteAsset} from "@/types";

export const ShyguySpriteAsset: SpriteAsset = {
	imageUrl: "/images/sprites/shyguy.png",
	sheet: rowSheet(4),
	palette: {
		primary: ["#ff0829"],
		skin: ["#ffbd8c"],
	},
};
