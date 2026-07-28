import type {ChatMessage, PlayerSnapshot, ServerMessage, ServerWelcome} from "@/shared/protocol";
import {
	isDirection,
	isHexColor,
	isInteger,
	isNumber,
	isRecord,
	parseAll,
} from "@/shared/protocol/guards";
import {parseProfile} from "@/shared/protocol/parseProfile";

// inbound trust boundary for the ws control plane, mirroring the server's
// parseMessage.ts on the other end. every frame is rebuilt from only the fields
// validated here, so nothing downstream dereferences a field the server didn't
// send — a shape that drifts between the two ends surfaces as a dropped frame
// rather than as `undefined` deep in the ui or the world. a frame that fails is
// dropped whole rather than repaired: a half-understood welcome would place the
// player somewhere the server disagrees with.

const PRESENCE_ACTIONS = ["join", "leave", "reconnect"] as const;

function parseChatMessage(value: unknown): ChatMessage | null {
	if (!isRecord(value)) return null;
	const {id, kind, text, timestamp} = value;
	if (typeof id !== "string" || !isNumber(timestamp)) return null;
	if (kind === "system") {
		if (typeof text !== "string") return null;
		return {id, kind, text, timestamp};
	}
	// chat and presence both carry the sender's identity inline, in the same
	// flattened shape a profile has.
	const sender = parseProfile(value);
	const {senderId, color} = value;
	if (!sender || typeof senderId !== "string" || !isHexColor(color)) return null;
	if (kind === "presence") {
		const action = PRESENCE_ACTIONS.find((candidate) => candidate === value.action);
		if (!action) return null;
		return {id, kind, action, senderId, color, ...sender, timestamp};
	}
	if (kind !== "chat" || typeof text !== "string") return null;
	const {rawText} = value;
	if (rawText !== undefined && typeof rawText !== "string") return null;
	return {
		id,
		kind,
		senderId,
		color,
		...sender,
		text,
		...(rawText === undefined ? {} : {rawText}),
		timestamp,
	};
}

function parsePlayerSnapshot(value: unknown): PlayerSnapshot | null {
	if (!isRecord(value)) return null;
	const {connId, idIndex, color, x, y, facing} = value;
	const profile = parseProfile(value.profile);
	if (!profile || typeof connId !== "string" || !isInteger(idIndex)) return null;
	if (!isHexColor(color) || !isNumber(x) || !isNumber(y) || !isDirection(facing)) return null;
	return {connId, idIndex, profile, color, x, y, facing};
}

function parseWelcome(value: Record<string, unknown>): ServerWelcome | null {
	const {connId, isAdmin, serverTick, serverTimeMs, resumeToken, spawn} = value;
	if (typeof connId !== "string" || typeof isAdmin !== "boolean") return null;
	if (!isInteger(serverTick) || !isNumber(serverTimeMs)) return null;
	if (typeof resumeToken !== "string" || !isRecord(spawn)) return null;
	if (!isNumber(spawn.x) || !isNumber(spawn.y)) return null;
	const players = parseAll(value.players, parsePlayerSnapshot);
	const chatBacklog = parseAll(value.chatBacklog, parseChatMessage);
	if (!players || !chatBacklog) return null;
	return {
		type: "welcome",
		connId,
		isAdmin,
		serverTick,
		serverTimeMs,
		resumeToken,
		spawn: {x: spawn.x, y: spawn.y},
		players,
		chatBacklog,
	};
}

export function parseServerMessage(raw: string): ServerMessage | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!isRecord(parsed)) return null;
	switch (parsed.type) {
		case "welcome":
			return parseWelcome(parsed);
		case "chat": {
			const message = parseChatMessage(parsed.message);
			return message ? {type: "chat", message} : null;
		}
		case "profileChanged": {
			const profile = parseProfile(parsed.profile);
			const {connId, color} = parsed;
			if (!profile || typeof connId !== "string" || !isHexColor(color)) return null;
			return {type: "profileChanged", connId, profile, color};
		}
		case "profileRejected":
			if (typeof parsed.reason !== "string") return null;
			return {type: "profileRejected", reason: parsed.reason};
		case "connectionRejected":
			if (typeof parsed.message !== "string") return null;
			return {type: "connectionRejected", message: parsed.message};
		case "join": {
			const player = parsePlayerSnapshot(parsed.player);
			return player ? {type: "join", player} : null;
		}
		case "leave":
			if (typeof parsed.connId !== "string") return null;
			return {type: "leave", connId: parsed.connId};
		default:
			return null;
	}
}
