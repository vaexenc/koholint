import {BoarblinSpriteAsset} from "@/sprites/assets/boarblin";
import {BowwowSpriteAsset} from "@/sprites/assets/bowwow";
import {BunnySpriteAsset} from "@/sprites/assets/bunny";
import {DarknutSpriteAsset} from "@/sprites/assets/darknut";
import {DinSpriteAsset} from "@/sprites/assets/din";
import {GhiniSpriteAsset} from "@/sprites/assets/ghini";
import {ImpaSpriteAsset} from "@/sprites/assets/impa";
import {LinkSpriteAsset} from "@/sprites/assets/link";
import {MapleSpriteAsset} from "@/sprites/assets/maple";
import {MarinSpriteAsset} from "@/sprites/assets/marin";
import {MoblinSpriteAsset} from "@/sprites/assets/moblin";
import {NayruSpriteAsset} from "@/sprites/assets/nayru";
import {OctorokSpriteAsset} from "@/sprites/assets/octorok";
import {RalphSpriteAsset} from "@/sprites/assets/ralph";
import {ShroudedStalfosSpriteAsset} from "@/sprites/assets/shrouded-stalfos";
import {ShyguySpriteAsset} from "@/sprites/assets/shyguy";
import {TarinSpriteAsset} from "@/sprites/assets/tarin";
import {ZeldaSpriteAsset} from "@/sprites/assets/zelda";
import {loadSpriteImage} from "@/sprites/imageCache";
import type {SpriteAsset} from "@/types";

export type Avatar = {
	id: string;
	name: string;
	// substituted for `name` in generated usernames when the display name
	// would make them too long.
	shortName?: string;
	sprite: SpriteAsset;
};

export const AVATARS: readonly Avatar[] = [
	// friendly — link's awakening
	{id: "link", name: "Link", sprite: LinkSpriteAsset},
	{id: "marin", name: "Marin", sprite: MarinSpriteAsset},
	{id: "tarin", name: "Tarin", sprite: TarinSpriteAsset},
	{id: "bunny", name: "Bunny", sprite: BunnySpriteAsset},
	{id: "bowwow", name: "BowWow", sprite: BowwowSpriteAsset},
	// friendly — oracle games
	{id: "din", name: "Din", sprite: DinSpriteAsset},
	{id: "nayru", name: "Nayru", sprite: NayruSpriteAsset},
	{id: "ralph", name: "Ralph", sprite: RalphSpriteAsset},
	{id: "maple", name: "Maple", sprite: MapleSpriteAsset},
	{id: "impa", name: "Impa", sprite: ImpaSpriteAsset},
	{id: "zelda", name: "Zelda", sprite: ZeldaSpriteAsset},
	// enemies
	{id: "octorok", name: "Octorok", sprite: OctorokSpriteAsset},
	{id: "moblin", name: "Moblin", sprite: MoblinSpriteAsset},
	{id: "boarblin", name: "Boarblin", sprite: BoarblinSpriteAsset},
	{id: "darknut", name: "Darknut", sprite: DarknutSpriteAsset},
	{
		id: "shrouded-stalfos",
		name: "Shrouded Stalfos",
		shortName: "Stalfos",
		sprite: ShroudedStalfosSpriteAsset,
	},
	{id: "shyguy", name: "Shy Guy", sprite: ShyguySpriteAsset},
	{id: "ghini", name: "Ghini", sprite: GhiniSpriteAsset},
];

export function resolveAvatarSprite(avatarId: string): SpriteAsset {
	return (AVATARS.find((a) => a.id === avatarId) ?? AVATARS[0]).sprite;
}

// warms the shared image cache for every avatar sheet so a character can be
// drawn the moment it appears (remote players can switch avatars at any time).
export function preloadAvatarSprites(): void {
	for (const avatar of AVATARS) {
		loadSpriteImage(avatar.sprite.imageUrl).catch(() => {});
	}
}
