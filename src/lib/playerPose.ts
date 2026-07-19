import type {Direction} from "@/game/types";
import {getStored, setStored} from "@/lib/safeStorage";

export type PlayerPose = {
	readonly x: number;
	readonly y: number;
	readonly facing: Direction;
};

// pose continuity across the online↔offline route switch: the leaving page
// hands its pose off, the arriving page takes it — the offline map spawns
// the player there, the online map starts the camera there. in-memory on
// purpose: it should survive the SPA navigation, not a reload. keyed by map
// url so a pose is never applied to a different map.
let handoff: {readonly mapUrl: string; readonly pose: PlayerPose} | null = null;

export function handOffPlayerPose(mapUrl: string, pose: PlayerPose): void {
	handoff = {mapUrl, pose};
}

export function takePlayerPose(mapUrl: string): PlayerPose | null {
	if (handoff?.mapUrl !== mapUrl) return null;
	const {pose} = handoff;
	handoff = null;
	return pose;
}

// pose continuity across sessions (offline mode only — online positions are
// server-assigned), also keyed by map url.
const STORED_POSE_PREFIX = "koholint:map.pose:";

export function savePlayerPose(mapUrl: string, pose: PlayerPose): void {
	setStored(STORED_POSE_PREFIX + mapUrl, JSON.stringify(pose));
}

export function loadPlayerPose(mapUrl: string): PlayerPose | null {
	const raw = getStored(STORED_POSE_PREFIX + mapUrl);
	if (raw === null) return null;
	try {
		return parsePose(JSON.parse(raw));
	} catch {
		return null;
	}
}

const DIRECTIONS: readonly Direction[] = ["up", "down", "left", "right"];

function isDirection(value: unknown): value is Direction {
	return DIRECTIONS.some((d) => d === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

// stored json is untrusted; rebuild the pose only from validated fields.
function parsePose(value: unknown): PlayerPose | null {
	if (!isRecord(value)) return null;
	const {x, y, facing} = value;
	if (typeof x !== "number" || !Number.isFinite(x)) return null;
	if (typeof y !== "number" || !Number.isFinite(y)) return null;
	if (!isDirection(facing)) return null;
	return {x, y, facing};
}
