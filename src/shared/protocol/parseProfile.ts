import {isRecord} from "@/shared/lib/isRecord";
import type {Profile} from "@/shared/protocol";

// shape check for a profile arriving from outside the program — a client frame,
// a storage slot, a server frame. rebuilds the value from only the fields it
// validates, so nothing unchecked rides along. membership of the avatar/palette
// ids is policy on top of this: the server rejects unknown ids outright, while
// the client renders a fallback for them, so each layer applies its own.
export function parseProfile(value: unknown): Profile | null {
	if (!isRecord(value)) return null;
	const {name, avatarId, paletteId} = value;
	if (typeof name !== "string" || typeof avatarId !== "string") return null;
	if (paletteId !== null && typeof paletteId !== "string") return null;
	return {name, avatarId, paletteId};
}
