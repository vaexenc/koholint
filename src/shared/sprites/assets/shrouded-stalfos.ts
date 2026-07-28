import {rowSheet} from "@/shared/sprites/sheet";
import type {SpriteAsset} from "@/shared/sprites/types";

export const ShroudedStalfosSpriteAsset: SpriteAsset = {
	imageUrl: "/images/sprites/shrouded-stalfos.png",
	sheet: rowSheet(4),
	palette: {
		primary: ["#1984ff"],
		skin: ["#ffbd8c"],
	},
};
