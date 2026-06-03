import type {TiledMap} from "@/tiled/loadMap";
import {hasBoolProperty, iterateObjectLayers} from "@/tiled/tileScan";
import {log} from "./log";

const SPAWN_PROPERTY = "spawn";

export type SpawnRegion =
	| {readonly kind: "point"; readonly x: number; readonly y: number}
	| {
			readonly kind: "rect";
			readonly x: number;
			readonly y: number;
			readonly w: number;
			readonly h: number;
	  };

// scans every object layer for objects tagged `spawn=true`. point objects
// (no positive width/height) become point spawns; rect objects become a
// uniformly-sampled rectangle. ellipses/polygons/polylines are intentionally
// unsupported per HANDOFF — they're skipped with a warning so map authors get
// feedback at boot instead of silent fallthrough.
export function collectSpawnRegions(map: TiledMap): SpawnRegion[] {
	const regions: SpawnRegion[] = [];
	for (const layer of iterateObjectLayers(map)) {
		for (const obj of layer.objects) {
			if (!hasBoolProperty(obj.properties, SPAWN_PROPERTY)) continue;
			if (isUnsupportedShape(obj)) {
				log.warn(`spawn object ${obj.id ?? "?"} has unsupported shape — skipping`);
				continue;
			}
			const x = obj.x ?? 0;
			const y = obj.y ?? 0;
			const w = obj.width ?? 0;
			const h = obj.height ?? 0;
			if (w > 0 && h > 0) regions.push({kind: "rect", x, y, w, h});
			else regions.push({kind: "point", x, y});
		}
	}
	return regions;
}

function isUnsupportedShape(obj: {
	ellipse?: boolean;
	polygon?: unknown;
	polyline?: unknown;
}): boolean {
	return Boolean(obj.ellipse) || Array.isArray(obj.polygon) || Array.isArray(obj.polyline);
}

export type Rng = () => number;

// picks a uniformly-random pixel inside a region. callers must follow up with
// resolveCharacterCollision to nudge out of any incidental solids/holes.
export function sampleSpawn(
	regions: ReadonlyArray<SpawnRegion>,
	rng: Rng = Math.random
): {x: number; y: number} {
	if (regions.length === 0) throw new Error("no spawn regions");
	const region = regions[Math.floor(rng() * regions.length)];
	if (region.kind === "point") return {x: region.x, y: region.y};
	return {x: region.x + rng() * region.w, y: region.y + rng() * region.h};
}
