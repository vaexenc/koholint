import {rowSheet} from "@/sprites/sheet";
import type {SpriteAsset} from "@/types";

export const MoblinSpriteAsset: SpriteAsset = {
	imageUrl: "/images/sprites/moblin.png",
	sheet: rowSheet(4),
	palette: {
		primary: ["#1984ff"],
		skin: ["#ffbd8c"],
	},
};
