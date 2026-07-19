import {rowSheet} from "@/sprites/sheet";
import type {SpriteAsset} from "@/types";

export const LinkSpriteAsset: SpriteAsset = {
	imageUrl: "/images/sprites/link.png",
	sheet: rowSheet(4),
	palette: {
		primary: ["#10ad42"],
		skin: ["#ffd68c"],
	},
};
