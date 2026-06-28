import {validateName, type NameValidation} from "@/lib/validateName";
import {
	englishDataset,
	englishRecommendedTransformers,
	RegExpMatcher,
	TextCensor,
} from "obscenity";

// server-only obscenity handling. obscenity must never reach the client bundle,
// so this lives under server/ and the username check runs authoritatively here
// rather than in the shared validateName.
const matcher = new RegExpMatcher({
	...englishDataset.build(),
	...englishRecommendedTransformers,
});

const censor = new TextCensor();

export function hasProfanity(text: string): boolean {
	return matcher.hasMatch(text);
}

// returns the text with any matched obscenities replaced by a grawlix-style
// mask. when nothing matches the input is returned unchanged.
export function censorProfanity(text: string): string {
	const matches = matcher.getAllMatches(text);
	if (matches.length === 0) return text;
	return censor.applyTo(text, matches);
}

// authoritative name validation shared by the ws handshake and the HTTP
// pre-check the settings UI calls. the syntactic rules live in the shared
// validateName; the obscenity gate is server-only so the package stays out of
// the client bundle. admins bypass the reserved list and the obscenity filter.
export function checkName(raw: string, isAdmin: boolean): NameValidation {
	const base = validateName(raw, {bypassReserved: isAdmin});
	if (!base.ok) return base;
	if (!isAdmin && hasProfanity(base.name))
		return {ok: false, reason: "name may not contain obscenities"};
	return base;
}
