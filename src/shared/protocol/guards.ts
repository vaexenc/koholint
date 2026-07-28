import type {Direction} from "@/shared/game/types";
import type {HexColor} from "@/shared/sprites/types";

// the primitive shape checks both ws trust boundaries are built from — the
// client's parseServerMessage and the server's parseClientMessage. shared so a
// value that one end considers well-formed can't be rejected by the other.

export {isRecord} from "@/shared/lib/isRecord";

export function isNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

export function isInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value);
}

const DIRECTIONS: readonly Direction[] = ["down", "left", "up", "right"];

export function isDirection(value: unknown): value is Direction {
	return DIRECTIONS.some((direction) => direction === value);
}

// full 6-digit form only. every colour on the wire is an accent picked from the
// palette table, and the consumers — canvas fillStyle, a color-mix() string, a
// react style prop — all silently ignore anything they can't parse, so the
// boundary is the only place a malformed one can still be caught.
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: unknown): value is HexColor {
	return typeof value === "string" && HEX_COLOR_PATTERN.test(value);
}

// every item must parse: a list silently missing entries is worse than a dropped
// frame, since the next one re-sends the whole thing.
export function parseAll<T>(value: unknown, parse: (item: unknown) => T | null): T[] | null {
	if (!Array.isArray(value)) return null;
	const parsed: T[] = [];
	for (const item of value) {
		const entry = parse(item);
		if (!entry) return null;
		parsed.push(entry);
	}
	return parsed;
}
