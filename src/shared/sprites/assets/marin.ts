import {rowSheet} from "@/shared/sprites/sheet";
import type {SpriteAsset} from "@/shared/sprites/types";

export const MarinSpriteAsset: SpriteAsset = {
	imageUrl: "/images/sprites/marin.png",
	sheet: rowSheet(4),
	palette: {
		primary: ["#ff7b08"],
		skin: ["#ffbd8c"],
	},
};
