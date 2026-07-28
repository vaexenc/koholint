import type {SpriteAsset} from "@/shared/sprites/types";

export const NayruSpriteAsset: SpriteAsset = {
	"imageUrl": "/images/sprites/nayru.png",
	"sheet": [
		{
			index: 0,
			x: 0,
			y: 0,
			width: 16,
			height: 16,
		},
		{
			index: 1,
			x: 17,
			y: 0,
			width: 16,
			height: 16,
		},
		{
			index: 2,
			x: 34,
			y: 0,
			width: 16,
			height: 16,
		},
		{
			index: 3,
			x: 51,
			y: 0,
			width: 16,
			height: 16,
			offsetX: 1,
		},
	],
	"palette": {
		primary: ["#1984ff"],
		skin: ["#ffd68c"],
	},
};
