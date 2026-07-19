import {rowSheet} from "@/sprites/sheet";
import type {SpriteAsset} from "@/types";

export const ZeldaSpriteAsset: SpriteAsset = {
	imageUrl: "/images/sprites/zelda.png",
	sheet: rowSheet(4, 16, 18),
	palette: {
		primary: ["#ff7b08"],
		skin: ["#ffd68c"],
	},
};
