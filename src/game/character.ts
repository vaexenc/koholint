import type {SpriteAsset, SpritePalette} from "@/types";
import {
	findNearestFreeAabb,
	moveAabb,
	unionGrids,
	type Aabb,
	type HoleGrid,
	type SolidGrid,
} from "./collision";
import {getTerrainSpeedMultiplier, type TerrainGrid} from "./terrain";
import {inputHasMovement, type CharacterInput, type Direction, type EntityId} from "./types";

// collision box anchored to a 16x16 sprite's lower-body footprint. matches
// the GB original well enough: feet (not head) decide where the body can go.
export const DEFAULT_COLLISION_BOX = {x: 2, y: 8, width: 12, height: 8} as const;

export const DEFAULT_CHARACTER_SPEED = 64;

// hop-over-hole timing. duration is short enough that input lockout is barely
// noticeable; peak height matches the GB sprite-jump look.
export const JUMP_DURATION_MS = 500;
export const JUMP_PEAK_HEIGHT_PX = 16;

export type CharacterJump = {
	readonly startX: number;
	readonly startY: number;
	readonly endX: number;
	readonly endY: number;
	readonly durationMs: number;
	elapsedMs: number;
};

export type BasicCharacter = {
	readonly id: EntityId;
	readonly sprite: SpriteAsset;
	readonly paletteSwap?: SpritePalette;
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
	holes?: HoleGrid
): void {
	char.prevX = char.x;
	char.prevY = char.y;
	char.prevJumpOffsetY = char.jumpOffsetY;
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
		const result = moveAabb(grid, before, moveX, moveY, holes);
		const endX = char.x + (result.position.x - before.x);
		const endY = char.y + (result.position.y - before.y);
		char.facing = nextFacing(char.facing, dx, dy);
		if (result.jumped) {
			startJump(char, endX, endY);
			advanceJump(char, dtSec);
			return;
		}
		char.x = endX;
		char.y = endY;
		char.walking = true;
		char.animTimeMs += dtSec * 1000;
	} else {
		char.walking = false;
		char.animTimeMs = 0;
	}
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
