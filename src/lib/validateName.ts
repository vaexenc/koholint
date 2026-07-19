export const NAME_MIN_LENGTH = 1;
export const NAME_MAX_LENGTH = 20;
export const NAME_PATTERN = /^[A-Za-z0-9 _-]+$/;

// case-insensitive blocklist for impersonation-prone display names. shared by
// client (inline error in the profile dialog) and server (authoritative
// reject). admin connections bypass this check.
export const RESERVED_NAMES: readonly string[] = [
	"system",
	"admin",
	"administrator",
	"moderator",
	"mod",
	"root",
	"server",
	"bot",
	"guest",
	"koholint",
	"staff",
	"official",
	"support",
	"nobody",
	"anonymous",
	"anon",
	"null",
	"undefined",
	"vaexenc",
];

const RESERVED_SET = new Set(RESERVED_NAMES.map((n) => n.toLowerCase()));

export type NameValidation = {ok: true; name: string} | {ok: false; reason: string};

export type ValidateNameOptions = {
	// admins bypass the reserved-names check so server operators can use any
	// display name. all other rules still apply.
	readonly bypassReserved?: boolean;
};

export function validateName(raw: string, opts: ValidateNameOptions = {}): NameValidation {
	// collapse internal whitespace runs and trim the ends so names may contain
	// single spaces without allowing blank-padded or irregularly spaced names.
	const name = raw.trim().replace(/\s+/g, " ");
	if (name.length < NAME_MIN_LENGTH) return {ok: false, reason: "name is required"};
	if (name.length > NAME_MAX_LENGTH)
		return {ok: false, reason: `name must be at most ${NAME_MAX_LENGTH} characters`};
	if (!NAME_PATTERN.test(name))
		return {ok: false, reason: "name may only contain letters, digits, spaces, _ and -"};
	if (!opts.bypassReserved && RESERVED_SET.has(name.toLowerCase()))
		return {ok: false, reason: "name is reserved"};
	return {ok: true, name};
}
