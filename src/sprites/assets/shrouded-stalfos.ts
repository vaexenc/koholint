import {rowSheet} from "@/sprites/sheet";
import type {SpriteAsset} from "@/types";

export const ShroudedStalfosSpriteAsset: SpriteAsset = {
	imageUrl: "/images/sprites/shrouded-stalfos.png",
	sheet: rowSheet(4),
	palette: {
		primary: ["#1984ff"],
		skin: ["#ffbd8c"],
	},
};
