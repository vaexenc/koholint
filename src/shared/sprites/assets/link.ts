import {rowSheet} from "@/shared/sprites/sheet";
import type {SpriteAsset} from "@/shared/sprites/types";

export const LinkSpriteAsset: SpriteAsset = {
	imageUrl: "/images/sprites/link.png",
	sheet: rowSheet(4),
	palette: {
		primary: ["#10ad42"],
		skin: ["#ffd68c"],
	},
};
