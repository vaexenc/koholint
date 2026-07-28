// canonical avatar id list and the single source of truth for which avatars
// exist. deliberately free of sprite-asset imports, so validating an id costs
// nothing but this file — ./avatars pairs each id here with its sheet, and
// reaching that catalog pulls all eighteen asset modules with it. the server
// checks incoming profiles against this list and has no use for the art.
export const AVATAR_IDS = [
	// friendly — link's awakening
	"link",
	"marin",
	"tarin",
	"bunny",
	"bowwow",
	// friendly — oracle games
	"din",
	"nayru",
	"ralph",
	"maple",
	"impa",
	"zelda",
	// enemies
	"octorok",
	"moblin",
	"boarblin",
	"darknut",
	"shrouded-stalfos",
	"shyguy",
	"ghini",
] as const;

export type AvatarId = (typeof AVATAR_IDS)[number];

const AVATAR_ID_SET: ReadonlySet<string> = new Set(AVATAR_IDS);

export function isKnownAvatarId(id: string): id is AvatarId {
	return AVATAR_ID_SET.has(id);
}
