import {rowSheet} from "@/sprites/sheet";
import type {SpriteAsset} from "@/types";

export const BunnySpriteAsset: SpriteAsset = {
	imageUrl: "/images/sprites/bunny.png",
	sheet: rowSheet(4),
	palette: {
		primary: ["#ff7b08"],
		skin: ["#ffbd8c"],
	},
};
