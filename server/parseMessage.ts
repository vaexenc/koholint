import {isKnownAvatarId} from "@/components/avatar-picker/avatarIds";
import type {CharacterInput} from "@/game/types";
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
} from "@/protocol";
import {isKnownPaletteId} from "@/sprites/palettes";

// authoritative trust boundary for the ws control plane. every client frame is
// untrusted: this rebuilds each message from only the fields it validates, so
// downstream handlers never dereference an absent or wrong-typed field (the
// crash surface) and never propagate an unknown avatar/palette id.

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseProfile(value: unknown): Profile | null {
	if (!isJsonObject(value)) return null;
	const {name, avatarId, paletteId} = value;
	if (typeof name !== "string") return null;
	if (typeof avatarId !== "string" || !isKnownAvatarId(avatarId)) return null;
	if (paletteId !== null && typeof paletteId !== "string") return null;
	if (typeof paletteId === "string" && !isKnownPaletteId(paletteId)) return null;
	return {name, avatarId, paletteId};
}

function parseHello(value: JsonObject): ClientHello | null {
	const profile = parseProfile(value);
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

function parseSetProfile(value: JsonObject): ClientSetProfile | null {
	const profile = parseProfile(value.profile);
	if (!profile) return null;
	return {type: "setProfile", profile};
}

function parseChat(value: JsonObject): ClientChat | null {
	if (typeof value.text !== "string") return null;
	return {type: "chat", text: value.text};
}

function parseCharacterInput(value: unknown): CharacterInput | null {
	if (!isJsonObject(value)) return null;
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
	if (!isJsonObject(value)) return null;
	const {tick, input} = value;
	if (typeof tick !== "number" || !Number.isInteger(tick)) return null;
	const parsedInput = parseCharacterInput(input);
	if (!parsedInput) return null;
	return {tick, input: parsedInput};
}

function parseInput(value: JsonObject): ClientInput | null {
	const {ackTick, inputs} = value;
	if (typeof ackTick !== "number" || !Number.isInteger(ackTick)) return null;
	if (!Array.isArray(inputs) || inputs.length > MAX_INPUTS_PER_MESSAGE) return null;
	const parsed: CoalescedInput[] = [];
	for (const item of inputs) {
		const coalesced = parseCoalescedInput(item);
		if (!coalesced) return null;
		parsed.push(coalesced);
	}
	return {type: "input", ackTick, inputs: parsed};
}

function parseTeleport(value: JsonObject): ClientTeleport | null {
	const {x, y} = value;
	if (typeof x !== "number" || !Number.isFinite(x)) return null;
	if (typeof y !== "number" || !Number.isFinite(y)) return null;
	return {type: "teleport", x, y};
}

function parseView(value: JsonObject): ClientView | null {
	const {w, h} = value;
	if (typeof w !== "number" || !Number.isFinite(w) || w <= 0) return null;
	if (typeof h !== "number" || !Number.isFinite(h) || h <= 0) return null;
	return {type: "view", w, h};
}

export function parseClientMessage(raw: string): ClientMessage | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!isJsonObject(parsed)) return null;
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
