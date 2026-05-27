import type {SpriteAsset, SpritePalette} from "@/types";
import {
	aabbOverlapsCliff,
	findCliffLanding,
	findNearestFreeAabb,
	findOverlappingCliff,
	moveAabb,
	unionGrids,
	type Aabb,
	type CliffGrid,
	type HoleGrid,
	type SolidGrid,
} from "./collision";
import {findOverlappingTeleporter, type Teleporter, type TeleporterGrid} from "./teleport";
import {getTerrainSpeedMultiplier, type TerrainGrid} from "./terrain";
import {inputHasMovement, type CharacterInput, type Direction, type EntityId} from "./types";

// collision box anchored to a 16x16 sprite's lower-body footprint. matches
// the GB original well enough: feet (not head) decide where the body can go.
export const DEFAULT_COLLISION_BOX = {x: 2, y: 8, width: 12, height: 8} as const;

export const DEFAULT_CHARACTER_SPEED = 64;

// todo: comment
export const DEFAULT_CORNER_SLIDE_PX = 7;

// hop-over-hole timing. duration is short enough that input lockout is barely
// noticeable; peak height matches the GB sprite-jump look.
export const JUMP_DURATION_MS = 500;
export const JUMP_PEAK_HEIGHT_PX = 16;

// rise-style teleport tuning. higher peak than a jump so the sprite reads as
// leaving the playfield rather than hopping in place.
export const TELEPORT_RISE_MS = 400;
export const TELEPORT_FALL_MS = TELEPORT_RISE_MS;
export const TELEPORT_PEAK_OFFSET_PX = 180;
// instant teleports have no animation but still pause input briefly so the
// player registers the jump-cut and doesn't immediately walk back through.
export const TELEPORT_INSTANT_LOCK_MS = 600;

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
	speed: number;
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
};

export type BasicCharacterOptions = {
	readonly id: EntityId;
	readonly sprite: SpriteAsset;
	readonly paletteSwap?: SpritePalette;
	readonly x: number;
	readonly y: number;
	readonly spriteWidth?: number;
	readonly spriteHeight?: number;
	readonly collisionBox?: {x: number; y: number; width: number; height: number};
	readonly speed?: number;
	readonly facing?: Direction;
};

export function createBasicCharacter(opts: BasicCharacterOptions): BasicCharacter {
	const base = opts.sprite.sheet[0];
	return {
		id: opts.id,
		sprite: opts.sprite,
		paletteSwap: opts.paletteSwap,
		x: opts.x,
		y: opts.y,
		prevX: opts.x,
		prevY: opts.y,
		spriteWidth: opts.spriteWidth ?? base?.width ?? 16,
		spriteHeight: opts.spriteHeight ?? base?.height ?? 16,
		collisionBox: opts.collisionBox ?? {...DEFAULT_COLLISION_BOX},
		speed: opts.speed ?? DEFAULT_CHARACTER_SPEED,
		facing: opts.facing ?? "down",
		walking: false,
		animTimeMs: 0,
		jump: null,
		teleport: null,
		jumpOffsetY: 0,
		prevJumpOffsetY: 0,
	};
}

// translates an input vector into an axis-separated swept move against the
// solid grid, then mutates the character in place. facing prefers to stick
// with whichever axis is currently still pressed, otherwise picks vertical
// over horizontal when the two compete — matches the GB feel. while a jump
// is in progress the input is ignored and the character coasts along the
// stored start→end arc.
export function stepCharacter(
	char: BasicCharacter,
	input: CharacterInput,
	dtSec: number,
	grid: SolidGrid,
	terrain?: TerrainGrid,
	holes?: HoleGrid,
	cliffs?: CliffGrid,
	teleporters?: TeleporterGrid
): void {
	char.prevX = char.x;
	char.prevY = char.y;
	char.prevJumpOffsetY = char.jumpOffsetY;
	if (char.teleport) {
		advanceTeleport(char, dtSec);
		return;
	}
	if (char.jump) {
		advanceJump(char, dtSec);
		return;
	}
	const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
	const dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
	const moving = inputHasMovement(input) && (dx !== 0 || dy !== 0);
	if (moving) {
		const len = Math.hypot(dx, dy);
		const before = characterAabb(char);
		const speedMultiplier = terrain ? getTerrainSpeedMultiplier(terrain, before) : 1;
		const stepDist = char.speed * speedMultiplier * dtSec;
		const moveX = (dx / len) * stepDist;
		const moveY = (dy / len) * stepDist;
		const result = moveAabb(grid, before, moveX, moveY, holes, {
			cornerSlackPx: DEFAULT_CORNER_SLIDE_PX,
			// cap the perp slide at this frame's walk distance so corner
			// correction reads as a smooth glide along the wall rather than
			// an instant pop to the open side.
			maxCornerNudgePx: stepDist,
		});
		const endX = char.x + (result.position.x - before.x);
		const endY = char.y + (result.position.y - before.y);
		char.facing = nextFacing(char.facing, dx, dy);
		if (result.jumped) {
			startJump(char, endX, endY);
			advanceJump(char, dtSec);
			return;
		}
		if (cliffs && tryCliffJump(char, before, result.position, grid, holes, cliffs)) {
			advanceJump(char, dtSec);
			return;
		}
		char.x = endX;
		char.y = endY;
		char.walking = true;
		char.animTimeMs += dtSec * 1000;
		if (teleporters) tryEnterTeleporter(char, before, teleporters);
	} else {
		char.walking = false;
		char.animTimeMs = 0;
	}
}

// edge-triggered cliff drop: a footprint that wasn't overlapping any cliff
// region last frame and now is gets launched along the region's painted
// direction to the first tile that's clear of solid, hole, and cliff.
// preserves this frame's perpendicular motion so diagonal approaches still
// read as diagonal hops. no-ops when the fall path is walled in so designers
// get a hard stop rather than a stuck body.
function tryCliffJump(
	char: BasicCharacter,
	before: Aabb,
	after: Aabb,
	grid: SolidGrid,
	holes: HoleGrid | undefined,
	cliffs: CliffGrid
): boolean {
	if (aabbOverlapsCliff(before, cliffs)) return false;
	const region = findOverlappingCliff(after, cliffs);
	if (!region) return false;
	const landing = findCliffLanding(grid, holes, cliffs, after, region.direction);
	if (!landing) return false;
	const horizontal = region.direction === "left" || region.direction === "right";
	const endX = char.x + ((horizontal ? landing.x : after.x) - before.x);
	const endY = char.y + ((horizontal ? after.y : landing.y) - before.y);
	startJump(char, endX, endY);
	return true;
}

function startJump(char: BasicCharacter, endX: number, endY: number): void {
	char.jump = {
		startX: char.x,
		startY: char.y,
		endX,
		endY,
		durationMs: JUMP_DURATION_MS,
		elapsedMs: 0,
	};
	char.walking = false;
	char.animTimeMs = 0;
}

function advanceJump(char: BasicCharacter, dtSec: number): void {
	const jump = char.jump!;
	jump.elapsedMs += dtSec * 1000;
	const t = Math.min(1, jump.elapsedMs / jump.durationMs);
	char.x = jump.startX + (jump.endX - jump.startX) * t;
	char.y = jump.startY + (jump.endY - jump.startY) * t;
	char.jumpOffsetY = jumpArcHeight(t);
	if (t >= 1) {
		char.x = jump.endX;
		char.y = jump.endY;
		char.jumpOffsetY = 0;
		char.jump = null;
	}
}

// symmetric parabolic arc peaking at t = 0.5 with zero endpoints.
function jumpArcHeight(t: number): number {
	return 4 * t * (1 - t) * JUMP_PEAK_HEIGHT_PX;
}

// edge-triggered warp: a footprint that wasn't overlapping any teleporter last
// frame and now is gets sent to its target's center. the edge condition is
// what keeps two mutually-linked teleporters from ping-ponging — the body
// arrives already overlapping the destination, so the next tick's before-check
// skips the retrigger until the player walks off and back on.
function tryEnterTeleporter(
	char: BasicCharacter,
	before: Aabb,
	teleporters: TeleporterGrid
): boolean {
	if (findOverlappingTeleporter(before, teleporters)) return false;
	const source = findOverlappingTeleporter(characterAabb(char), teleporters);
	if (!source) return false;
	const target = teleporters.byId.get(source.targetId);
	if (!target) return false;
	const dest = teleportDestination(char, target, source);
	startTeleport(char, dest, source.type);
	return true;
}

function teleportDestination(
	char: BasicCharacter,
	target: Teleporter,
	source: Teleporter
): {readonly x: number; readonly y: number} {
	const box = char.collisionBox;
	const centerX = target.box.x + target.box.width / 2;
	const centerY = target.box.y + target.box.height / 2;
	return {
		x: centerX - (box.x + box.width / 2) + source.destOffsetX,
		y: centerY - (box.y + box.height / 2) + source.destOffsetY,
	};
}

function startTeleport(
	char: BasicCharacter,
	dest: {readonly x: number; readonly y: number},
	type: Teleporter["type"]
): void {
	char.walking = false;
	char.animTimeMs = 0;
	if (type === "instant") {
		char.x = dest.x;
		char.y = dest.y;
		char.prevX = char.x;
		char.prevY = char.y;
		char.facing = "down";
		// reuse the fall phase with a zero-height arc as a pure input lockout:
		// jumpOffsetY stays at 0, the timer just gates inputs for a moment.
		char.teleport = {
			destX: dest.x,
			destY: dest.y,
			riseDurationMs: 0,
			fallDurationMs: TELEPORT_INSTANT_LOCK_MS,
			peakOffsetY: 0,
			phase: "fall",
			elapsedMs: 0,
		};
		return;
	}
	char.teleport = {
		destX: dest.x,
		destY: dest.y,
		riseDurationMs: TELEPORT_RISE_MS,
		fallDurationMs: TELEPORT_FALL_MS,
		peakOffsetY: TELEPORT_PEAK_OFFSET_PX,
		phase: "rise",
		elapsedMs: 0,
	};
}

// rise lifts the sprite while the body stays at the source; the peak snaps
// position to the destination (with prev = current to suppress the renderer's
// inter-tick lerp); fall drops the sprite back to the ground at the dest.
function advanceTeleport(char: BasicCharacter, dtSec: number): void {
	const tp = char.teleport!;
	tp.elapsedMs += dtSec * 1000;
	if (tp.phase === "rise") {
		const t = Math.min(1, tp.elapsedMs / tp.riseDurationMs);
		char.jumpOffsetY = tp.peakOffsetY * t;
		if (t < 1) return;
		char.x = tp.destX;
		char.y = tp.destY;
		char.prevX = char.x;
		char.prevY = char.y;
		char.jumpOffsetY = tp.peakOffsetY;
		char.prevJumpOffsetY = tp.peakOffsetY;
		tp.phase = "fall";
		tp.elapsedMs = 0;
		return;
	}
	const t = Math.min(1, tp.elapsedMs / tp.fallDurationMs);
	char.jumpOffsetY = tp.peakOffsetY * (1 - t);
	if (t >= 1) {
		char.jumpOffsetY = 0;
		char.teleport = null;
	}
}

export function characterAabb(char: BasicCharacter): Aabb {
	return {
		x: char.x + char.collisionBox.x,
		y: char.y + char.collisionBox.y,
		width: char.collisionBox.width,
		height: char.collisionBox.height,
	};
}

// nudges a character out of any solid (or, when supplied, hole) tile it's
// currently overlapping by snapping its collision box to the closest free
// position. returns true when the character was actually moved. no-op when
// already free or when the grid contains no reachable free spot within the
// search radius.
export function resolveCharacterCollision(
	char: BasicCharacter,
	grid: SolidGrid,
	holes?: HoleGrid
): boolean {
	const combined = holes ? unionGrids(grid, holes) : grid;
	const before = characterAabb(char);
	const after = findNearestFreeAabb(combined, before);
	if (!after || (after.x === before.x && after.y === before.y)) return false;
	char.x += after.x - before.x;
	char.y += after.y - before.y;
	char.prevX = char.x;
	char.prevY = char.y;
	return true;
}

function nextFacing(prev: Direction, dx: number, dy: number): Direction {
	const horiz: Direction | null = dx > 0 ? "right" : dx < 0 ? "left" : null;
	const vert: Direction | null = dy > 0 ? "down" : dy < 0 ? "up" : null;
	if (horiz && vert) {
		// when both axes are pressed, hold the previous facing if it's still
		// active so a diagonal walk doesn't pop the sprite to a new direction
		// every frame.
		if (prev === horiz || prev === vert) return prev;
		return vert;
	}
	return horiz ?? vert ?? prev;
}
