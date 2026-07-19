import {rowSheet} from "@/sprites/sheet";
import type {SpriteAsset} from "@/types";

export const MapleSpriteAsset: SpriteAsset = {
	imageUrl: "/images/sprites/maple.png",
	sheet: rowSheet(4, 16, 21),
	palette: {
		primary: ["#ff0829"],
		skin: ["#ffd68c"],
	},
};
