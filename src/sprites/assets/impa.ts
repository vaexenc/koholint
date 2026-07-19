import {rowSheet} from "@/sprites/sheet";
import type {SpriteAsset} from "@/types";

export const ImpaSpriteAsset: SpriteAsset = {
	imageUrl: "/images/sprites/impa.png",
	sheet: rowSheet(4),
	palette: {
		primary: ["#ce0829"],
		skin: ["#ffd68c"],
	},
};
