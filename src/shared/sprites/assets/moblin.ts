import {rowSheet} from "@/shared/sprites/sheet";
import type {SpriteAsset} from "@/shared/sprites/types";

export const MoblinSpriteAsset: SpriteAsset = {
	imageUrl: "/images/sprites/moblin.png",
	sheet: rowSheet(4),
	palette: {
		primary: ["#1984ff"],
		skin: ["#ffbd8c"],
	},
};
