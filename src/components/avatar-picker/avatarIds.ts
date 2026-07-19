// canonical avatar id list and the single source of truth for which avatars
// exist. kept DOM-free (no sprite-asset imports) so the server can validate
// incoming profiles against it without pulling the client sprite registry,
// which reaches for the DOM image cache and won't compile under the server's
// lib config. the client registry pairs each id here with its sprite.
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
