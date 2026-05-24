import type {AvatarData} from "../types";
import {LinkAvatar} from "./link";
import {NayruAvatar} from "./nayru";

export type AvatarEntry = {
	id: string;
	name: string;
	data: AvatarData;
};

export const AVATARS: readonly AvatarEntry[] = [
	{id: "link", name: "Link", data: LinkAvatar},
	{id: "nayru", name: "Nayru", data: NayruAvatar},
];
