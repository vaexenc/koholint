import type {SpriteAsset} from "@/shared/sprites/types";

// non-uniform sheet: the dance pose's flying ponytail widens the side frames
// (gutters sit at x 16/32/54), so the rects are hand-cut and offsetX
// re-centers each frame's body — not its rect — on the tile.
export const DinSpriteAsset: SpriteAsset = {
	imageUrl: "/images/sprites/din.png",
	sheet: [
		{index: 0, x: 0, y: 0, width: 16, height: 20, offsetY: -4},
		{index: 1, x: 17, y: 0, width: 15, height: 20, offsetY: -4},
		{index: 2, x: 33, y: 0, width: 21, height: 20, offsetX: 1, offsetY: -4},
		{index: 3, x: 55, y: 0, width: 20, height: 20, offsetX: 2, offsetY: -4},
	],
	palette: {
		primary: ["#ff0829"],
		skin: ["#ffd68c"],
	},
};
