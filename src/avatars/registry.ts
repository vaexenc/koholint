import {LinkAvatar} from "./link";
import {NayruAvatar} from "./nayru";
import type {AvatarData} from "../types";

export type AvatarEntry = {
	id: string;
	name: string;
	imageUrl: string;
	data: AvatarData;
};

export const AVATARS: readonly AvatarEntry[] = [
	{id: "link", name: "Link", imageUrl: "/images/sprites/link.png", data: LinkAvatar},
	{id: "nayru", name: "Nayru", imageUrl: "/images/sprites/nayru.png", data: NayruAvatar},
];
