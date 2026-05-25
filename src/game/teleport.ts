import type {TiledMap} from "@/tiled/loadMap";
import {iterateObjectLayers, type TiledProperty} from "@/tiled/tileScan";
import {aabbsOverlap, type Aabb} from "./collision";

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
			const targetId = getNumberProperty(obj.properties, TELEPORT_TO_PROPERTY);
			if (targetId === null) continue;
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

export function findOverlappingTeleporter(
	box: Aabb,
	teleporters: TeleporterGrid
): Teleporter | null {
	for (const t of teleporters.all) if (aabbsOverlap(box, t.box)) return t;
	return null;
}

function parseTeleporterType(value: string | null): TeleporterType {
	return value === "rise" ? "rise" : "instant";
}

function getNumberProperty(
	props: ReadonlyArray<TiledProperty> | undefined,
	name: string
): number | null {
	if (!props) return null;
	for (const p of props) {
		if (p.name !== name) continue;
		if (
			(p.type === "object" || p.type === "int" || p.type === "float") &&
			typeof p.value === "number"
		)
			return p.value;
	}
	return null;
}

function getStringProperty(
	props: ReadonlyArray<TiledProperty> | undefined,
	name: string
): string | null {
	if (!props) return null;
	for (const p of props) {
		if (p.name === name && p.type === "string" && typeof p.value === "string") return p.value;
	}
	return null;
}
