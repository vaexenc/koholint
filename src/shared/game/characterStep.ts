import {lerp} from "@/shared/lib/math";
import {ANIM_BYTE_MAX, ANIM_BYTE_SCALE_MS} from "@/shared/protocol/snapshot";
import {WALK_CYCLE_MS} from "@/shared/sprites/animations";
import {
	characterAabb,
	characterAabbAt,
	placeCharacter,
	type BasicCharacter,
	type CharacterJump,
	type CharacterTeleport,
} from "./character";
import {
	aabbOverlapsCliff,
	CLIFF_DIRECTION_VECTORS,
	findCliffLanding,
	findOverlappingCliff,
	type CliffGrid,
} from "./cliffs";
import {aabbsOverlap, clampOutOfBox, moveAabb, type Aabb} from "./collision";
import type {WorldGrids} from "./grids";
import {samplePush} from "./push";
import {enterTeleporter, latchHolds, type TeleporterGrid, type TeleporterType} from "./teleport";
import {getTerrainSpeedMultiplier, isSwimTile, type TerrainGrid} from "./terrain";
import {inputHasMovement, type CharacterInput, type Direction} from "./types";

// one tick of a character: the walk sweep, the conveyor push, and the two
// input-locked arcs (hop, warp) a step can hand the body off to. character.ts
// owns the body and how it is placed; this owns what a tick does to it, and the
// dependency runs one way — every rule module (cliffs, teleport, push, terrain,
// collision) is consulted from here, none of them from the model.

// keep the walk-phase accumulator bounded so the snapshot's one-byte phase
// encoding never saturates; left unbounded it pins the byte after ~4s of
// continuous walking, which freezes every observer's walk animation on a single
// frame. wrap on a whole walk cycle so the wrap is seamless (the pose at the
// wrap point is the pose at zero), and derive the largest whole number of cycles
// that still fits under the byte ceiling so any future timing change can't
// silently reintroduce the saturation.
const ANIM_PHASE_WRAP_MS =
	Math.floor((ANIM_BYTE_MAX * ANIM_BYTE_SCALE_MS) / WALK_CYCLE_MS) * WALK_CYCLE_MS;

// how deep a corner clip the sweep will slide the body out of (see
// MoveOptions.cornerSlackPx). a bit under half the collision box's 12px width,
// so a body that clearly overlaps the blocking cell still stops dead while a
// near-miss on the corner glides past — the GB original is forgiving here.
const DEFAULT_CORNER_SLIDE_PX = 7;

// hop-over-hole timing. duration is short enough that input lockout is barely
// noticeable; peak height matches the GB sprite-jump look.
const JUMP_DURATION_MS = 500;
const JUMP_PEAK_HEIGHT_PX = 16;

// rise-style teleport tuning. higher peak than a jump so the sprite reads as
// leaving the playfield rather than hopping in place.
const TELEPORT_RISE_MS = 400;
const TELEPORT_FALL_MS = TELEPORT_RISE_MS;
const TELEPORT_PEAK_OFFSET_PX = 180;
// instant teleports have no animation but still pause input briefly so the
// player registers the jump-cut and doesn't immediately walk back through.
const TELEPORT_INSTANT_LOCK_MS = 600;

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
	grids: WorldGrids
): void {
	char.prevX = char.x;
	char.prevY = char.y;
	char.prevJumpOffsetY = char.jumpOffsetY;
	if (char.teleport) {
		advanceTeleport(char, char.teleport, dtSec);
		return;
	}
	if (char.jump) {
		// the pre-jump footprint, captured before advanceJump can clear the jump. if
		// the jump lands on a teleporter, this off-pad "before" makes the landing an
		// edge so the warp fires: a jump drops the body straight onto the pad, which
		// the per-frame edge check otherwise misses since the next frame already
		// starts overlapping (so it only fired after stepping off and back on).
		const preJump = characterAabbAt(char, char.jump.startX, char.jump.startY);
		advanceJump(char, char.jump, dtSec);
		if (!char.jump) tryEnterTeleporter(char, preJump, grids.teleporters);
		return;
	}
	const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
	const dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
	const moving = inputHasMovement(input) && (dx !== 0 || dy !== 0);
	if (moving) {
		const len = Math.hypot(dx, dy);
		const before = characterAabb(char);
		const stepDist = char.speed * getTerrainSpeedMultiplier(grids.terrain, before) * dtSec;
		const moveX = (dx / len) * stepDist;
		const moveY = (dy / len) * stepDist;
		const result = moveAabb(grids.solid, before, moveX, moveY, grids.holes, {
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
		char.facing = nextFacing(char.facing, dx, dy);
		if (result.jumped) {
			const hop = startJump(
				char,
				char.x + (resolved.x - before.x),
				char.y + (resolved.y - before.y)
			);
			advanceJump(char, hop, dtSec);
			return;
		}
		const cliffHop = tryCliffJump(char, before, resolved, grids);
		if (cliffHop) {
			advanceJump(char, cliffHop, dtSec);
			return;
		}
		const walked = blockSwimCliffClimb(before, resolved, grids.terrain, grids.cliffs);
		char.x += walked.x - before.x;
		char.y += walked.y - before.y;
		char.walking = true;
		char.animTimeMs = (char.animTimeMs + dtSec * 1000) % ANIM_PHASE_WRAP_MS;
		tryEnterTeleporter(char, before, grids.teleporters);
	} else {
		char.walking = false;
		char.animTimeMs = 0;
	}
	applyPush(char, dtSec, grids);
}

// conveyor push: tiles tagged with pushX/pushY apply a continuous velocity
// (px/sec) to any body resting on them. resolved against solids only — walls
// halt the drift — and applied on top of the body's own motion so walking
// against a current nets out. uses the same corner-slide as manual movement so
// a current carries the body past a clipped corner instead of snagging on it.
// skipped while airborne, since a jump/teleport returns before reaching here.
function applyPush(char: BasicCharacter, dtSec: number, grids: WorldGrids): void {
	const before = characterAabb(char);
	const v = samplePush(grids.push, before);
	if (v.x === 0 && v.y === 0) return;
	const {position} = moveAabb(grids.solid, before, v.x * dtSec, v.y * dtSec, undefined, {
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
// a fall (blocked for swimmers by blockSwimCliffClimb). preserves this
// frame's perpendicular motion so diagonal approaches
// still read as diagonal hops. no-ops when the fall path is walled in so
// designers get a hard stop rather than a stuck body.
function tryCliffJump(
	char: BasicCharacter,
	before: Aabb,
	after: Aabb,
	grids: WorldGrids
): CharacterJump | null {
	const cliffs = grids.cliffs;
	if (aabbOverlapsCliff(before, cliffs)) return null;
	const region = findOverlappingCliff(after, cliffs);
	if (!region) return null;
	const [dirX, dirY] = CLIFF_DIRECTION_VECTORS[region.direction];
	if ((after.x - before.x) * dirX + (after.y - before.y) * dirY <= 0) return null;
	const landing = findCliffLanding(grids, after, region.direction);
	if (!landing) return null;
	const horizontal = region.direction === "left" || region.direction === "right";
	const endX = char.x + ((horizontal ? landing.x : after.x) - before.x);
	const endY = char.y + ((horizontal ? after.y : landing.y) - before.y);
	return startJump(char, endX, endY);
}

// swimmers can't climb out of the water over a cliff's fall edge: while the
// footprint center is on a swim tile, cliff regions act as walls, clamped
// per-axis so the body slides along the cliff base instead of stopping dead.
// runs after tryCliffJump so hopping over an edge in the fall direction still
// wins. only fresh entries clamp — a body already overlapping a region (e.g.
// dropped there by a reconciliation snap) moves freely so it can't wedge stuck.
function blockSwimCliffClimb(
	before: Aabb,
	after: Aabb,
	terrain: TerrainGrid,
	cliffs: CliffGrid
): Aabb {
	if (!isSwimTile(terrain, before) || aabbOverlapsCliff(before, cliffs)) return after;
	let clamped = after;
	for (const region of cliffs.regions) {
		if (aabbsOverlap(clamped, region)) clamped = clampOutOfBox(before, clamped, region);
	}
	return clamped;
}

// returns the jump it started, so the caller can advance it without having to
// re-read (and re-narrow) the character's now-non-null jump slot.
function startJump(char: BasicCharacter, endX: number, endY: number): CharacterJump {
	const jump: CharacterJump = {
		startX: char.x,
		startY: char.y,
		endX,
		endY,
		durationMs: JUMP_DURATION_MS,
		elapsedMs: 0,
	};
	char.jump = jump;
	char.walking = false;
	char.animTimeMs = 0;
	return jump;
}

function advanceJump(char: BasicCharacter, jump: CharacterJump, dtSec: number): void {
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

// hands the body to whatever warp its motion just triggered (see
// enterTeleporter, which owns the pad rules and the latch that keeps
// mutually-linked pads from ping-ponging).
function tryEnterTeleporter(char: BasicCharacter, before: Aabb, teleporters: TeleporterGrid): void {
	const here = characterAabb(char);
	// re-arm the destination pad once the body steps clear of the region it
	// landed in. until then, holding the direction that points back at the pad
	// (e.g. up, into the cave it just came out of) is suppressed.
	if (char.teleportLatch && !latchHolds(char.teleportLatch, here)) char.teleportLatch = null;
	const entry = enterTeleporter(char.collisionBox, char.teleportLatch, before, here, teleporters);
	if (!entry) return;
	char.teleportLatch = entry.latch;
	startTeleport(char, entry.dest, entry.type);
}

function startTeleport(
	char: BasicCharacter,
	dest: {readonly x: number; readonly y: number},
	type: TeleporterType
): void {
	char.walking = false;
	char.animTimeMs = 0;
	if (type === "instant") {
		placeCharacter(char, {x: dest.x, y: dest.y, facing: "down"});
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
function advanceTeleport(char: BasicCharacter, tp: CharacterTeleport, dtSec: number): void {
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
