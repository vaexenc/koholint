import {BoarblinSpriteAsset} from "@/shared/sprites/assets/boarblin";
import {BowwowSpriteAsset} from "@/shared/sprites/assets/bowwow";
import {BunnySpriteAsset} from "@/shared/sprites/assets/bunny";
import {DarknutSpriteAsset} from "@/shared/sprites/assets/darknut";
import {DinSpriteAsset} from "@/shared/sprites/assets/din";
import {GhiniSpriteAsset} from "@/shared/sprites/assets/ghini";
import {ImpaSpriteAsset} from "@/shared/sprites/assets/impa";
import {LinkSpriteAsset} from "@/shared/sprites/assets/link";
import {MapleSpriteAsset} from "@/shared/sprites/assets/maple";
import {MarinSpriteAsset} from "@/shared/sprites/assets/marin";
import {MoblinSpriteAsset} from "@/shared/sprites/assets/moblin";
import {NayruSpriteAsset} from "@/shared/sprites/assets/nayru";
import {OctorokSpriteAsset} from "@/shared/sprites/assets/octorok";
import {RalphSpriteAsset} from "@/shared/sprites/assets/ralph";
import {ShroudedStalfosSpriteAsset} from "@/shared/sprites/assets/shrouded-stalfos";
import {ShyguySpriteAsset} from "@/shared/sprites/assets/shyguy";
import {TarinSpriteAsset} from "@/shared/sprites/assets/tarin";
import {ZeldaSpriteAsset} from "@/shared/sprites/assets/zelda";
import {AVATAR_IDS, type AvatarId} from "@/shared/sprites/avatarIds";
import type {SpriteAsset} from "@/shared/sprites/types";

// the id -> art catalog. names the sheets without ever decoding one, so it can
// sit on the headless side: the server pulls it in to resolve a player's accent
// color (see ./profileAccent). warming those sheets is @/client/sprites/preloadAvatars'
// job, on the other side of the DOM line.

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

// an id nobody knows falls back to the first avatar rather than rendering
// nothing — the server rejects unknown ids, so this only covers a client whose
// catalog is older (or newer) than the one that authored the profile. the one
// place that fallback lives, so the world, the picker and the chat icons can't
// disagree about what an unknown id looks like.
export function resolveAvatar(avatarId: string): Avatar {
	return AVATARS.find((a) => a.id === avatarId) ?? AVATARS[0];
}

export function resolveAvatarSprite(avatarId: string): SpriteAsset {
	return resolveAvatar(avatarId).sprite;
}
