import type {Aabb} from "@/shared/lib/rect";
import type {TiledMap} from "@/shared/tiled/loadMap";
import {
	getNumberProperty,
	getObjectRefProperty,
	getStringProperty,
	iterateObjectLayers,
} from "@/shared/tiled/tileScan";
import {aabbsOverlap} from "./collision";

const TELEPORT_TO_PROPERTY = "teleportTo";
const TELEPORT_TYPE_PROPERTY = "teleportType";
const TELEPORT_TO_OFFSET_X_PROPERTY = "teleportToOffsetX";
const TELEPORT_TO_OFFSET_Y_PROPERTY = "teleportToOffsetY";

export type TeleporterType = "instant" | "rise";

export type Teleporter = {
	readonly id: number;
	readonly box: Aabb;
	readonly targetId: number;
	readonly type: TeleporterType;
	// per-source pixel offset applied on top of the target's center, so a
	// single destination can receive arrivals at different spots depending on
	// which source sent the body.
	readonly destOffsetX: number;
	readonly destOffsetY: number;
};

// flat list plus an id->teleporter index so the simulation can resolve a
// trigger's destination without rescanning every region per tick.
export type TeleporterGrid = {
	readonly all: ReadonlyArray<Teleporter>;
	readonly byId: ReadonlyMap<number, Teleporter>;
};

// scans every object layer for objects carrying a teleportTo property and
// turns them into a lookup table. objects without a positive width/height or
// without an id can't act as trigger or destination so they're dropped.
export function buildTeleporterGrid(map: TiledMap): TeleporterGrid {
	const all: Teleporter[] = [];
	const byId = new Map<number, Teleporter>();
	for (const layer of iterateObjectLayers(map)) {
		for (const obj of layer.objects) {
			if (obj.id === undefined) continue;
			const targetId = getObjectRefProperty(obj.properties, TELEPORT_TO_PROPERTY);
			if (targetId === undefined) continue;
			const width = obj.width ?? 0;
			const height = obj.height ?? 0;
			if (width <= 0 || height <= 0) continue;
			const teleporter: Teleporter = {
				id: obj.id,
				box: {x: obj.x, y: obj.y, width, height},
				targetId,
				type: parseTeleporterType(
					getStringProperty(obj.properties, TELEPORT_TYPE_PROPERTY)
				),
				destOffsetX: getNumberProperty(obj.properties, TELEPORT_TO_OFFSET_X_PROPERTY) ?? 0,
				destOffsetY: getNumberProperty(obj.properties, TELEPORT_TO_OFFSET_Y_PROPERTY) ?? 0,
			};
			all.push(teleporter);
			byId.set(teleporter.id, teleporter);
		}
	}
	return {all, byId};
}

function parseTeleporterType(value: string | undefined): TeleporterType {
	return value === "rise" ? "rise" : "instant";
}

function findOverlappingTeleporter(box: Aabb, teleporters: TeleporterGrid): Teleporter | null {
	for (const t of teleporters.all) if (aabbsOverlap(box, t.box)) return t;
	return null;
}

// set right after every warp so the destination pad can't immediately re-fire.
// `zone` is the region the body must step clear of to re-arm the pad. `block`,
// when present, is kept solid so holding the entry direction can't climb back
// onto the destination's solid cave tile — only stand-in-front destinations
// (offset onto the floor beside a solid tile) need it; stand-on-top
// destinations leave it undefined since the pad itself stays pathable.
export type TeleportLatch = {readonly id: number; readonly block?: Aabb; readonly zone: Aabb};

// px the body must travel past its landing spot, away from the pad, to re-arm.
const TELEPORT_REARM_MARGIN_PX = 3;

// whether a standing latch still suppresses its pad. it holds until the body
// steps clear of the region it landed in, which is what keeps mutually-linked
// pads from ping-ponging (and survives the netcode's reconciliation replay,
// since that snaps position back across the warp boundary but leaves the latch
// intact).
export function latchHolds(latch: TeleportLatch, here: Aabb): boolean {
	return aabbsOverlap(here, latch.zone);
}

// where a warp sends the body, and the latch it arms on arrival.
export type TeleportEntry = {
	readonly dest: {readonly x: number; readonly y: number};
	readonly type: TeleporterType;
	readonly latch: TeleportLatch;
};

// edge-triggered warp: a footprint that wasn't overlapping any teleporter last
// frame and now is gets sent to its target. `collisionBox` is the body's
// sprite-local box, which is what the destination is centered on. returns null
// when the motion triggered nothing — the caller stays put.
export function enterTeleporter(
	collisionBox: Aabb,
	latch: TeleportLatch | null,
	before: Aabb,
	here: Aabb,
	teleporters: TeleporterGrid
): TeleportEntry | null {
	if (findOverlappingTeleporter(before, teleporters)) return null;
	const source = findOverlappingTeleporter(here, teleporters);
	if (!source) return null;
	if (source.id === latch?.id) return null;
	const target = teleporters.byId.get(source.targetId);
	if (!target) return null;
	const dest = teleportDestination(collisionBox, target, source);
	return {dest, type: source.type, latch: buildLatch(collisionBox, target, dest, source.type)};
}

function teleportDestination(
	collisionBox: Aabb,
	target: Teleporter,
	source: Teleporter
): {readonly x: number; readonly y: number} {
	const centerX = target.box.x + target.box.width / 2;
	const centerY = target.box.y + target.box.height / 2;
	return {
		x: centerX - (collisionBox.x + collisionBox.width / 2) + source.destOffsetX,
		y: centerY - (collisionBox.y + collisionBox.height / 2) + source.destOffsetY,
	};
}

// builds the latch for a fresh warp. a rise pad (a pit that hops the body out a
// short way) and a stand-on-top destination (no offset, e.g. a stairs tile) both
// keep the ground pathable: the latch needs no solid block — its zone is just the
// pad (plus a re-arm margin), so stepping off re-arms it and walking back on fires
// it again. a stand-in-front destination, offset onto the floor beside the pad's
// solid cave tile, also gets a block spanning pad→landing so holding the entry
// direction can't climb back.
function buildLatch(
	collisionBox: Aabb,
	target: Teleporter,
	dest: {readonly x: number; readonly y: number},
	type: TeleporterType
): TeleportLatch {
	const landing: Aabb = {
		x: dest.x + collisionBox.x,
		y: dest.y + collisionBox.y,
		width: collisionBox.width,
		height: collisionBox.height,
	};
	if (type === "rise" || aabbsOverlap(landing, target.box)) {
		return {
			id: target.id,
			zone: {
				x: target.box.x - TELEPORT_REARM_MARGIN_PX,
				y: target.box.y - TELEPORT_REARM_MARGIN_PX,
				width: target.box.width + 2 * TELEPORT_REARM_MARGIN_PX,
				height: target.box.height + 2 * TELEPORT_REARM_MARGIN_PX,
			},
		};
	}
	const x = latchSpan(target.box.x, target.box.width, landing.x, landing.width);
	const y = latchSpan(target.box.y, target.box.height, landing.y, landing.height);
	return {
		id: target.id,
		// block — pad through to the landing's near edge, kept solid so the body
		// can't climb back toward the cave while latched.
		block: {
			x: x.blockMin,
			y: y.blockMin,
			width: x.blockMax - x.blockMin,
			height: y.blockMax - y.blockMin,
		},
		// zone — block plus a small margin past the landing; the latch re-arms once
		// the footprint leaves it, so a short step away is enough.
		zone: {
			x: x.zoneMin,
			y: y.zoneMin,
			width: x.zoneMax - x.zoneMin,
			height: y.zoneMax - y.zoneMin,
		},
	};
}

// per-axis extents for the latch regions. on the axis the landing is offset
// along, block spans pad→landing-near-edge and zone reaches a margin past it; on
// an axis where pad and landing overlap, both just span the union.
function latchSpan(
	padStart: number,
	padLen: number,
	landStart: number,
	landLen: number
): {blockMin: number; blockMax: number; zoneMin: number; zoneMax: number} {
	const padEnd = padStart + padLen;
	const landEnd = landStart + landLen;
	if (landStart >= padEnd) {
		return {
			blockMin: padStart,
			blockMax: landStart,
			zoneMin: padStart,
			zoneMax: landStart + TELEPORT_REARM_MARGIN_PX,
		};
	}
	if (landEnd <= padStart) {
		return {
			blockMin: landEnd,
			blockMax: padEnd,
			zoneMin: landEnd - TELEPORT_REARM_MARGIN_PX,
			zoneMax: padEnd,
		};
	}
	const min = Math.min(padStart, landStart);
	const max = Math.max(padEnd, landEnd);
	return {blockMin: min, blockMax: max, zoneMin: min, zoneMax: max};
}
