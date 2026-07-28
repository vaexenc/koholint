import {getStored, setStored} from "@/client/lib/safeStorage";
import type {Direction} from "@/shared/game/types";
import {isDirection, isNumber, isRecord} from "@/shared/protocol/guards";

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

// persists the pose on every way out of a map, not just the one the caller can
// see: react cleanup covers leaving the page, but a reload or a tab close skips
// it entirely, so a `pagehide` listener covers that half. returns the detach,
// which also performs the save — so the caller states "keep this pose until we
// leave" once, and the two exit paths can't drift apart the way they do when a
// page wires up the listener and the teardown separately.
export function persistPoseUntilExit(mapUrl: string, getPose: () => PlayerPose | null): () => void {
	const save = () => {
		const pose = getPose();
		if (pose) savePlayerPose(mapUrl, pose);
	};
	window.addEventListener("pagehide", save);
	return () => {
		window.removeEventListener("pagehide", save);
		save();
	};
}

function loadPlayerPose(mapUrl: string): PlayerPose | null {
	const raw = getStored(STORED_POSE_PREFIX + mapUrl);
	if (raw === null) return null;
	try {
		return parsePose(JSON.parse(raw));
	} catch {
		return null;
	}
}

// the map a pose has to land on to still mean anything. spelled structurally so
// GameHostContext satisfies it as-is.
export type MapExtent = {readonly mapPixelWidth: number; readonly mapPixelHeight: number};

// the pose a map load should start the player at: whatever the other mode
// handed over, else the one this browser stored for this map — and either only
// while it still falls inside the map, since a pose saved under an older shape
// of it can sit outside. null means "spawn fresh".
//
// this is the one answer to "is a stored pose usable": the shape check and the
// bounds check are both here, so a caller can't arrive at a different one.
export function takeArrivalPose(mapUrl: string, extent: MapExtent): PlayerPose | null {
	const pose = takePlayerPose(mapUrl) ?? loadPlayerPose(mapUrl);
	if (!pose) return null;
	const onMap =
		pose.x >= 0 &&
		pose.x < extent.mapPixelWidth &&
		pose.y >= 0 &&
		pose.y < extent.mapPixelHeight;
	return onMap ? pose : null;
}

// stored json is untrusted; rebuild the pose only from validated fields.
function parsePose(value: unknown): PlayerPose | null {
	if (!isRecord(value)) return null;
	const {x, y, facing} = value;
	if (!isNumber(x) || !isNumber(y) || !isDirection(facing)) return null;
	return {x, y, facing};
}
