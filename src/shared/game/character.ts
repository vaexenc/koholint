import {lerp} from "@/shared/lib/math";
import {sheetFootprint} from "@/shared/sprites/sheet";
import type {SpriteAsset, SpritePalette} from "@/shared/sprites/types";
import {findNearestFreeAabb, unionGrids, type Aabb} from "./collision";
import type {WorldGrids} from "./grids";
import type {TeleportLatch} from "./teleport";
import type {Direction, EntityId} from "./types";

// the body every player is: what a character is made of, where it can be put,
// and how its pose reads. deliberately free of what a *tick* does to it — the
// walk sweep and the hop/warp arcs live in ./characterStep, which imports this
// and not the other way round, so the model can be built, placed and drawn
// without dragging in the movement rules.

// collision box anchored to a 16x16 sprite's lower-body footprint. matches
// the GB original well enough: feet (not head) decide where the body can go.
const DEFAULT_COLLISION_BOX = {x: 2, y: 8, width: 12, height: 8} as const;

const DEFAULT_CHARACTER_SPEED = 64;

export type CharacterJump = {
	readonly startX: number;
	readonly startY: number;
	readonly endX: number;
	readonly endY: number;
	readonly durationMs: number;
	elapsedMs: number;
};

// two-phase animation: the body stays at the source while rising, snaps to the
// destination at the peak, then falls in place. inputs are ignored for the
// whole duration so the player can't cancel mid-warp.
export type CharacterTeleport = {
	readonly destX: number;
	readonly destY: number;
	readonly riseDurationMs: number;
	readonly fallDurationMs: number;
	readonly peakOffsetY: number;
	phase: "rise" | "fall";
	elapsedMs: number;
};

export type BasicCharacter = {
	readonly id: EntityId;
	// sprite and paletteSwap are mutable so callers (e.g. the avatar picker)
	// can change appearance at runtime without removing/re-adding the entity.
	// pair any mutation with a renderer cache invalidation + ensureLoaded.
	sprite: SpriteAsset;
	paletteSwap?: SpritePalette;
	// top-left of the sprite in map pixels. mutable so step() can move it.
	x: number;
	y: number;
	// position at the start of the most recent tick. the renderer lerps from
	// (prevX, prevY) toward (x, y) by the clock's accumulator alpha so motion
	// stays smooth even at low tick rates. teleports set prev = current to
	// avoid a visible slide from the old pose.
	prevX: number;
	prevY: number;
	readonly spriteWidth: number;
	readonly spriteHeight: number;
	// collision box in sprite-local coords (relative to x/y).
	readonly collisionBox: {x: number; y: number; width: number; height: number};
	readonly speed: number;
	facing: Direction;
	walking: boolean;
	// accumulates while walking; used to phase the walk animation.
	animTimeMs: number;
	// non-null while the character is mid-hop; inputs are ignored and ground
	// position interpolates linearly from start to end of the strip.
	jump: CharacterJump | null;
	// non-null while the character is mid-warp. shares jumpOffsetY with the
	// renderer so the rise/fall reads through the same vertical lift channel
	// as a hop. inputs are ignored for the whole sequence.
	teleport: CharacterTeleport | null;
	// arc height above the logical ground, lerped by the renderer using the
	// same prev/current pairing as x/y.
	jumpOffsetY: number;
	prevJumpOffsetY: number;
	// non-null while a stand-in-front warp is latched; see TeleportLatch.
	teleportLatch: TeleportLatch | null;
};

// every character in the world is a player: same footprint, same box, same
// speed. only identity, look and placement vary, so those are all this takes —
// a character that needs its own physique can grow the options then, with a
// caller that actually sets them.
export type BasicCharacterOptions = {
	readonly id: EntityId;
	readonly sprite: SpriteAsset;
	readonly paletteSwap?: SpritePalette;
	readonly x: number;
	readonly y: number;
	readonly facing?: Direction;
};

export function createBasicCharacter(opts: BasicCharacterOptions): BasicCharacter {
	// footprint, not raw frame size: art taller than the tile hangs above the
	// anchor via a negative offsetY, and feet line, y-sort and water line all
	// follow the extent below the anchor.
	const footprint = sheetFootprint(opts.sprite.sheet);
	return {
		id: opts.id,
		sprite: opts.sprite,
		paletteSwap: opts.paletteSwap,
		x: opts.x,
		y: opts.y,
		prevX: opts.x,
		prevY: opts.y,
		spriteWidth: footprint.width,
		spriteHeight: footprint.height,
		collisionBox: {...DEFAULT_COLLISION_BOX},
		speed: DEFAULT_CHARACTER_SPEED,
		facing: opts.facing ?? "down",
		walking: false,
		animTimeMs: 0,
		jump: null,
		teleport: null,
		jumpOffsetY: 0,
		prevJumpOffsetY: 0,
		teleportLatch: null,
	};
}

// clears whatever the simulation is mid-way through: the hop and warp arcs and
// the vertical lift they share. position is left alone, so a caller that only
// needs to stop an animation (control handoff, a correction that lands where
// the body already is) doesn't have to name a position it isn't changing.
export function cancelAirborne(char: BasicCharacter): void {
	char.jump = null;
	char.teleport = null;
	char.jumpOffsetY = 0;
	char.prevJumpOffsetY = 0;
}

// puts a character at a position outright — a spawn, a teleport, an
// authoritative correction — rather than moving it there. prev is pinned to
// current so the renderer doesn't slide the sprite across the gap, any in-flight
// arc is cancelled (it would otherwise keep driving the body away from where it
// was just placed), and the walk cycle restarts so the sprite doesn't arrive
// mid-stride. this is the one place that knows which state a hard placement has
// to reset, so a new piece of transient motion is added to the character in one
// place rather than in every caller that moves one.
export function placeCharacter(
	char: BasicCharacter,
	at: {readonly x: number; readonly y: number; readonly facing?: Direction}
): void {
	char.x = at.x;
	char.y = at.y;
	char.prevX = at.x;
	char.prevY = at.y;
	if (at.facing) char.facing = at.facing;
	cancelAirborne(char);
	char.walking = false;
	char.animTimeMs = 0;
}

// where to place a character so its collision box sits centered on the tile
// containing (worldX, worldY) — what "teleport me to that tile" means. inverts
// the tile readout the HUD shows, so a click lands on exactly the tile it named.
export function tileCenterPlacement(
	char: Pick<BasicCharacter, "collisionBox">,
	tiles: {readonly tilewidth: number; readonly tileheight: number},
	worldX: number,
	worldY: number
): {x: number; y: number} {
	const box = char.collisionBox;
	const tileX = Math.floor(worldX / tiles.tilewidth);
	const tileY = Math.floor(worldY / tiles.tileheight);
	return {
		x: (tileX + 0.5) * tiles.tilewidth - (box.x + box.width / 2),
		y: (tileY + 0.5) * tiles.tileheight - (box.y + box.height / 2),
	};
}

// drops a character onto the tile under a world point and nudges it out of
// whatever it landed in — what "teleport there" means, for the admin click
// online and the same click on the offline/test map. the pair is the whole
// definition, so it lives beside placeCharacter rather than being spelled out
// once per caller for the two to drift apart.
export function teleportToTile(
	char: BasicCharacter,
	tiles: {readonly tilewidth: number; readonly tileheight: number},
	grids: WorldGrids,
	worldX: number,
	worldY: number
): void {
	placeCharacter(char, tileCenterPlacement(char, tiles, worldX, worldY));
	resolveCharacterCollision(char, grids);
}

// nudges a character out of any solid or hole tile it's currently overlapping by
// snapping its collision box to the closest free position. returns true when the
// character was actually moved. no-op when already free or when the grid contains
// no reachable free spot within the search radius.
export function resolveCharacterCollision(char: BasicCharacter, grids: WorldGrids): boolean {
	const combined = unionGrids(grids.solid, grids.holes);
	const before = characterAabb(char);
	const after = findNearestFreeAabb(combined, before);
	if (!after || (after.x === before.x && after.y === before.y)) return false;
	char.x += after.x - before.x;
	char.y += after.y - before.y;
	char.prevX = char.x;
	char.prevY = char.y;
	return true;
}

// the collision box the character would occupy standing at (x, y) — for the
// sweep's "where was I before this arc started" probes, which ask about a
// position the body isn't at.
export function characterAabbAt(char: BasicCharacter, x: number, y: number): Aabb {
	const cb = char.collisionBox;
	return {x: x + cb.x, y: y + cb.y, width: cb.width, height: cb.height};
}

export function characterAabb(char: BasicCharacter): Aabb {
	return characterAabbAt(char, char.x, char.y);
}

// world-space center of the character's collision box — the point steering,
// tile readouts, and teleports anchor on.
export function collisionCenter(char: Pick<BasicCharacter, "x" | "y" | "collisionBox">): {
	x: number;
	y: number;
} {
	const box = char.collisionBox;
	return {x: char.x + box.x + box.width / 2, y: char.y + box.y + box.height / 2};
}

// every channel the renderer interpolates between the previous and current
// tick, at one alpha. anything that has to line up with the drawn sprite — the
// camera chasing it, the tags and bubbles hanging above it — reads it from here,
// so a channel added to the interpolation reaches all of them at once instead of
// whichever call sites remembered to add it.
//
// consumers still choose their own anchor: the camera follows the ground
// position and deliberately ignores jumpOffset (a teleport rise would otherwise
// sweep the viewport up with it), while above-head overlays subtract it so they
// ride the sprite.
export type InterpolatedPose = {
	readonly x: number;
	readonly y: number;
	readonly jumpOffset: number;
};

export function interpolatedPose(
	char: Pick<BasicCharacter, "x" | "y" | "prevX" | "prevY" | "jumpOffsetY" | "prevJumpOffsetY">,
	alpha: number
): InterpolatedPose {
	return {
		x: lerp(char.prevX, char.x, alpha),
		y: lerp(char.prevY, char.y, alpha),
		jumpOffset: lerp(char.prevJumpOffsetY, char.jumpOffsetY, alpha),
	};
}
