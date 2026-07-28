import {rowSheet} from "@/shared/sprites/sheet";
import type {SpriteAsset} from "@/shared/sprites/types";

export const MapleSpriteAsset: SpriteAsset = {
	imageUrl: "/images/sprites/maple.png",
	sheet: rowSheet(4, 16, 21),
	palette: {
		primary: ["#ff0829"],
		skin: ["#ffd68c"],
	},
};
