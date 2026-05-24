import {LinkSpriteAsset} from "@/sprites/assets/link";
import {NayruSpriteAsset} from "@/sprites/assets/nayru";
import type {SpriteAsset} from "@/types";

export type Avatar = {
	id: string;
	name: string;
	sprite: SpriteAsset;
};

export const AVATARS: readonly Avatar[] = [
	{id: "link", name: "Link", sprite: LinkSpriteAsset},
	{id: "nayru", name: "Nayru", sprite: NayruSpriteAsset},
];
