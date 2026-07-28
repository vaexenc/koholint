import type {CharacterInput} from "@/shared/game/types";
import {
	MAX_INPUTS_PER_MESSAGE,
	type ClientChat,
	type ClientHello,
	type ClientInput,
	type ClientMessage,
	type ClientSetProfile,
	type ClientTeleport,
	type ClientView,
	type CoalescedInput,
	type Profile,
} from "@/shared/protocol";
import {isInteger, isNumber, isRecord, parseAll} from "@/shared/protocol/guards";
import {parseProfile} from "@/shared/protocol/parseProfile";
import {isKnownAvatarId} from "@/shared/sprites/avatarIds";
import {isKnownPaletteId} from "@/shared/sprites/palettes";

// authoritative trust boundary for the ws control plane. every client frame is
// untrusted: this rebuilds each message from only the fields it validates, so
// downstream handlers never dereference an absent or wrong-typed field (the
// crash surface) and never propagate an unknown avatar/palette id.

// the shared shape check plus the server's own policy: an id nobody can render
// must never reach another client, so unknown ids reject the whole message
// rather than falling back to a default the sender didn't choose.
function parseKnownProfile(value: unknown): Profile | null {
	const profile = parseProfile(value);
	if (!profile) return null;
	if (!isKnownAvatarId(profile.avatarId)) return null;
	if (profile.paletteId !== null && !isKnownPaletteId(profile.paletteId)) return null;
	return profile;
}

function parseHello(value: Record<string, unknown>): ClientHello | null {
	const profile = parseKnownProfile(value);
	if (!profile) return null;
	const {adminToken, resumeToken} = value;
	if (adminToken !== undefined && typeof adminToken !== "string") return null;
	if (resumeToken !== undefined && typeof resumeToken !== "string") return null;
	return {
		type: "hello",
		name: profile.name,
		avatarId: profile.avatarId,
		paletteId: profile.paletteId,
		...(adminToken === undefined ? {} : {adminToken}),
		...(resumeToken === undefined ? {} : {resumeToken}),
	};
}

function parseSetProfile(value: Record<string, unknown>): ClientSetProfile | null {
	const profile = parseKnownProfile(value.profile);
	if (!profile) return null;
	return {type: "setProfile", profile};
}

function parseChat(value: Record<string, unknown>): ClientChat | null {
	if (typeof value.text !== "string") return null;
	return {type: "chat", text: value.text};
}

function parseCharacterInput(value: unknown): CharacterInput | null {
	if (!isRecord(value)) return null;
	const {up, down, left, right} = value;
	if (
		typeof up !== "boolean" ||
		typeof down !== "boolean" ||
		typeof left !== "boolean" ||
		typeof right !== "boolean"
	)
		return null;
	return {up, down, left, right};
}

function parseCoalescedInput(value: unknown): CoalescedInput | null {
	if (!isRecord(value)) return null;
	const {tick, input} = value;
	if (!isInteger(tick)) return null;
	const parsedInput = parseCharacterInput(input);
	if (!parsedInput) return null;
	return {tick, input: parsedInput};
}

function parseInput(value: Record<string, unknown>): ClientInput | null {
	const {ackTick, inputs} = value;
	if (!isInteger(ackTick)) return null;
	if (!Array.isArray(inputs) || inputs.length > MAX_INPUTS_PER_MESSAGE) return null;
	const parsed = parseAll(inputs, parseCoalescedInput);
	if (!parsed) return null;
	return {type: "input", ackTick, inputs: parsed};
}

function parseTeleport(value: Record<string, unknown>): ClientTeleport | null {
	const {x, y} = value;
	if (!isNumber(x) || !isNumber(y)) return null;
	return {type: "teleport", x, y};
}

function parseView(value: Record<string, unknown>): ClientView | null {
	const {w, h} = value;
	if (!isNumber(w) || w <= 0 || !isNumber(h) || h <= 0) return null;
	return {type: "view", w, h};
}

export function parseClientMessage(raw: string): ClientMessage | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!isRecord(parsed)) return null;
	switch (parsed.type) {
		case "hello":
			return parseHello(parsed);
		case "setProfile":
			return parseSetProfile(parsed);
		case "chat":
			return parseChat(parsed);
		case "input":
			return parseInput(parsed);
		case "teleport":
			return parseTeleport(parsed);
		case "view":
			return parseView(parsed);
		case "leave":
			return {type: "leave"};
		default:
			return null;
	}
}
