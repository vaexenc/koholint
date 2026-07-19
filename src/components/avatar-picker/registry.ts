import {AVATAR_IDS, type AvatarId} from "@/components/avatar-picker/avatarIds";
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
	id: AvatarId;
	name: string;
	// substituted for `name` in generated usernames when the display name
	// would make them too long.
	shortName?: string;
	sprite: SpriteAsset;
};

type AvatarMeta = Omit<Avatar, "id">;

// id -> sprite/display metadata. keyed by AvatarId so the compiler forces this
// map and AVATAR_IDS to stay in lockstep: a missing or extra id is a type error.
const AVATAR_META: Record<AvatarId, AvatarMeta> = {
	link: {name: "Link", sprite: LinkSpriteAsset},
	marin: {name: "Marin", sprite: MarinSpriteAsset},
	tarin: {name: "Tarin", sprite: TarinSpriteAsset},
	bunny: {name: "Bunny", sprite: BunnySpriteAsset},
	bowwow: {name: "BowWow", sprite: BowwowSpriteAsset},
	din: {name: "Din", sprite: DinSpriteAsset},
	nayru: {name: "Nayru", sprite: NayruSpriteAsset},
	ralph: {name: "Ralph", sprite: RalphSpriteAsset},
	maple: {name: "Maple", sprite: MapleSpriteAsset},
	impa: {name: "Impa", sprite: ImpaSpriteAsset},
	zelda: {name: "Zelda", sprite: ZeldaSpriteAsset},
	octorok: {name: "Octorok", sprite: OctorokSpriteAsset},
	moblin: {name: "Moblin", sprite: MoblinSpriteAsset},
	boarblin: {name: "Boarblin", sprite: BoarblinSpriteAsset},
	darknut: {name: "Darknut", sprite: DarknutSpriteAsset},
	"shrouded-stalfos": {
		name: "Shrouded Stalfos",
		shortName: "Stalfos",
		sprite: ShroudedStalfosSpriteAsset,
	},
	shyguy: {name: "Shy Guy", sprite: ShyguySpriteAsset},
	ghini: {name: "Ghini", sprite: GhiniSpriteAsset},
};

export const AVATARS: readonly Avatar[] = AVATAR_IDS.map((id) => ({id, ...AVATAR_META[id]}));

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
