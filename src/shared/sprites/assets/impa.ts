import {rowSheet} from "@/shared/sprites/sheet";
import type {SpriteAsset} from "@/shared/sprites/types";

export const ImpaSpriteAsset: SpriteAsset = {
	imageUrl: "/images/sprites/impa.png",
	sheet: rowSheet(4),
	palette: {
		primary: ["#ce0829"],
		skin: ["#ffd68c"],
	},
};
