import {ANIM_BYTE_MAX, ANIM_BYTE_SCALE_MS} from "@/protocol";
import {WALK_CYCLE_MS} from "@/sprites/animations";
import {sheetFootprint} from "@/sprites/sheet";
import type {SpriteAsset, SpritePalette} from "@/types";
import {
	aabbOverlapsCliff,
	aabbsOverlap,
	clampOutOfBox,
	CLIFF_DIRECTION_VECTORS,
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
import {lerp} from "./math";
import {samplePush, type PushGrid} from "./push";
import {findOverlappingTeleporter, type Teleporter, type TeleporterGrid} from "./teleport";
import {getTerrainSpeedMultiplier, type TerrainGrid} from "./terrain";
import {inputHasMovement, type CharacterInput, type Direction, type EntityId} from "./types";

// collision box anchored to a 16x16 sprite's lower-body footprint. matches
// the GB original well enough: feet (not head) decide where the body can go.
export const DEFAULT_COLLISION_BOX = {x: 2, y: 8, width: 12, height: 8} as const;

export const DEFAULT_CHARACTER_SPEED = 64;

// keep the walk-phase accumulator bounded so the snapshot's one-byte phase
// encoding never saturates; left unbounded it pins the byte after ~4s of
// continuous walking, which freezes every observer's walk animation on a single
// frame. wrap on a whole walk cycle so the wrap is seamless (the pose at the
// wrap point is the pose at zero), and derive the largest whole number of cycles
// that still fits under the byte ceiling so any future timing change can't
// silently reintroduce the saturation.
const ANIM_PHASE_WRAP_MS =
	Math.floor((ANIM_BYTE_MAX * ANIM_BYTE_SCALE_MS) / WALK_CYCLE_MS) * WALK_CYCLE_MS;

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

// set right after every warp so the destination pad can't immediately re-fire.
// `zone` is the region the body must step clear of to re-arm the pad. `block`,
// when present, is kept solid so holding the entry direction can't climb back
// onto the destination's solid cave tile — only stand-in-front destinations
// (offset onto the floor beside a solid tile) need it; stand-on-top
// destinations leave it undefined since the pad itself stays pathable.
export type TeleportLatch = {readonly id: number; readonly block?: Aabb; readonly zone: Aabb};

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
	// non-null while a stand-in-front warp is latched; see TeleportLatch.
	teleportLatch: TeleportLatch | null;
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
		spriteWidth: opts.spriteWidth ?? footprint.width,
		spriteHeight: opts.spriteHeight ?? footprint.height,
		collisionBox: opts.collisionBox ?? {...DEFAULT_COLLISION_BOX},
		speed: opts.speed ?? DEFAULT_CHARACTER_SPEED,
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
	teleporters?: TeleporterGrid,
	push?: PushGrid
): void {
	char.prevX = char.x;
	char.prevY = char.y;
	char.prevJumpOffsetY = char.jumpOffsetY;
	if (char.teleport) {
		advanceTeleport(char, dtSec);
		return;
	}
	if (char.jump) {
		// the pre-jump footprint, captured before advanceJump can clear the jump. if
		// the jump lands on a teleporter, this off-pad "before" makes the landing an
		// edge so the warp fires: a jump drops the body straight onto the pad, which
		// the per-frame edge check otherwise misses since the next frame already
		// starts overlapping (so it only fired after stepping off and back on).
		const preJump = aabbAtPosition(char, char.jump.startX, char.jump.startY);
		advanceJump(char, dtSec);
		if (!char.jump && teleporters) tryEnterTeleporter(char, preJump, teleporters);
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
		// while latched in front of a solid cave tile, the gap between the pad and
		// the landing spot is solid so holding the entry direction can't climb back
		// toward the cave tile (and the wall behind it). the latch clears once the
		// body steps off the landing spot (see tryEnterTeleporter).
		const resolved = char.teleportLatch?.block
			? clampOutOfBox(before, result.position, char.teleportLatch.block)
			: result.position;
		const endX = char.x + (resolved.x - before.x);
		const endY = char.y + (resolved.y - before.y);
		char.facing = nextFacing(char.facing, dx, dy);
		if (result.jumped) {
			startJump(char, endX, endY);
			advanceJump(char, dtSec);
			return;
		}
		if (cliffs && tryCliffJump(char, before, resolved, grid, terrain, holes, cliffs)) {
			advanceJump(char, dtSec);
			return;
		}
		char.x = endX;
		char.y = endY;
		char.walking = true;
		char.animTimeMs = (char.animTimeMs + dtSec * 1000) % ANIM_PHASE_WRAP_MS;
		if (teleporters) tryEnterTeleporter(char, before, teleporters);
	} else {
		char.walking = false;
		char.animTimeMs = 0;
	}
	if (push) applyPush(char, dtSec, grid, push);
}

// conveyor push: tiles tagged with pushX/pushY apply a continuous velocity
// (px/sec) to any body resting on them. resolved against solids only — walls
// halt the drift — and applied on top of the body's own motion so walking
// against a current nets out. uses the same corner-slide as manual movement so
// a current carries the body past a clipped corner instead of snagging on it.
// skipped while airborne, since a jump/teleport returns before reaching here.
function applyPush(char: BasicCharacter, dtSec: number, grid: SolidGrid, push: PushGrid): void {
	const before = characterAabb(char);
	const v = samplePush(push, before);
	if (v.x === 0 && v.y === 0) return;
	const {position} = moveAabb(grid, before, v.x * dtSec, v.y * dtSec, undefined, {
		cornerSlackPx: DEFAULT_CORNER_SLIDE_PX,
		maxCornerNudgePx: Math.hypot(v.x, v.y) * dtSec,
	});
	char.x += position.x - before.x;
	char.y += position.y - before.y;
}

// edge-triggered cliff drop: a footprint that wasn't overlapping any cliff
// region last frame and now is gets launched along the region's painted
// direction to the first landable tile (see findCliffLanding). only fires
// when the motion carries into the fall direction — entering the region
// against it (e.g. swimming into the cliff base from below) is a climb, not
// a fall. preserves this frame's perpendicular motion so diagonal approaches
// still read as diagonal hops. no-ops when the fall path is walled in so
// designers get a hard stop rather than a stuck body.
function tryCliffJump(
	char: BasicCharacter,
	before: Aabb,
	after: Aabb,
	grid: SolidGrid,
	terrain: TerrainGrid | undefined,
	holes: HoleGrid | undefined,
	cliffs: CliffGrid
): boolean {
	if (aabbOverlapsCliff(before, cliffs)) return false;
	const region = findOverlappingCliff(after, cliffs);
	if (!region) return false;
	const [dirX, dirY] = CLIFF_DIRECTION_VECTORS[region.direction];
	if ((after.x - before.x) * dirX + (after.y - before.y) * dirY <= 0) return false;
	const landing = findCliffLanding(grid, terrain, holes, cliffs, after, region.direction);
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
	char.x = lerp(jump.startX, jump.endX, t);
	char.y = lerp(jump.startY, jump.endY, t);
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
// frame and now is gets sent to its target. every warp arms a teleportLatch on
// the destination pad so it can't immediately re-fire — the latch holds until
// the body steps clear of the landing region, which is what keeps mutually-linked
// pads from ping-ponging (and survives the netcode's reconciliation replay, since
// that snaps position back across the warp boundary but leaves the latch intact).
function tryEnterTeleporter(
	char: BasicCharacter,
	before: Aabb,
	teleporters: TeleporterGrid
): boolean {
	const here = characterAabb(char);
	// re-arm the destination pad once the body steps clear of the region it
	// landed in. until then, holding the direction that points back at the pad
	// (e.g. up, into the cave it just came out of) is suppressed below.
	if (char.teleportLatch && !aabbsOverlap(here, char.teleportLatch.zone)) {
		char.teleportLatch = null;
	}
	if (findOverlappingTeleporter(before, teleporters)) return false;
	const source = findOverlappingTeleporter(here, teleporters);
	if (!source) return false;
	if (source.id === char.teleportLatch?.id) return false;
	const target = teleporters.byId.get(source.targetId);
	if (!target) return false;
	const dest = teleportDestination(char, target, source);
	char.teleportLatch = buildTeleportLatch(char, target, dest, source.type);
	startTeleport(char, dest, source.type);
	return true;
}

// px the body must travel past its landing spot, away from the pad, to re-arm.
const TELEPORT_REARM_MARGIN_PX = 3;

// builds the latch for a fresh warp. a rise pad (a pit that hops the body out a
// short way) and a stand-on-top destination (no offset, e.g. a stairs tile) both
// keep the ground pathable: the latch needs no solid block — its zone is just the
// pad (plus a re-arm margin), so stepping off re-arms it and walking back on fires
// it again. a stand-in-front destination, offset onto the floor beside the pad's
// solid cave tile, also gets a block spanning pad→landing so holding the entry
// direction can't climb back.
function buildTeleportLatch(
	char: BasicCharacter,
	target: Teleporter,
	dest: {readonly x: number; readonly y: number},
	type: Teleporter["type"]
): TeleportLatch {
	const cb = char.collisionBox;
	const landing: Aabb = {
		x: dest.x + cb.x,
		y: dest.y + cb.y,
		width: cb.width,
		height: cb.height,
	};
	// a rise warp (a pit that hops the body out onto open ground) and a stand-on-top
	// destination both leave no solid block, and the re-arm zone is just the pad —
	// so the latch clears the instant the body steps off and walking back on fires
	// it again.
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

function aabbAtPosition(char: BasicCharacter, x: number, y: number): Aabb {
	const cb = char.collisionBox;
	return {x: x + cb.x, y: y + cb.y, width: cb.width, height: cb.height};
}

export function characterAabb(char: BasicCharacter): Aabb {
	return aabbAtPosition(char, char.x, char.y);
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
