import type {SpriteAsset, SpritePalette} from "@/types";
import {findNearestFreeAabb, moveAabb, type Aabb, type SolidGrid} from "./collision";
import {inputHasMovement, type CharacterInput, type Direction, type EntityId} from "./types";

// collision box anchored to a 16x16 sprite's lower-body footprint. matches
// the GB original well enough: feet (not head) decide where the body can go.
export const DEFAULT_COLLISION_BOX = {x: 2, y: 8, width: 12, height: 8} as const;

export const DEFAULT_CHARACTER_SPEED = 64;

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
	};
}

// translates an input vector into an axis-separated swept move against the
// solid grid, then mutates the character in place. facing prefers to stick
// with whichever axis is currently still pressed, otherwise picks vertical
// over horizontal when the two compete — matches the GB feel.
export function stepCharacter(
	char: BasicCharacter,
	input: CharacterInput,
	dtSec: number,
	grid: SolidGrid
): void {
	char.prevX = char.x;
	char.prevY = char.y;
	const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
	const dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
	const moving = inputHasMovement(input) && (dx !== 0 || dy !== 0);
	if (moving) {
		const len = Math.hypot(dx, dy);
		const stepDist = char.speed * dtSec;
		const moveX = (dx / len) * stepDist;
		const moveY = (dy / len) * stepDist;
		const before = characterAabb(char);
		const after = moveAabb(grid, before, moveX, moveY);
		char.x += after.x - before.x;
		char.y += after.y - before.y;
		char.facing = nextFacing(char.facing, dx, dy);
		char.walking = true;
		char.animTimeMs += dtSec * 1000;
	} else {
		char.walking = false;
		char.animTimeMs = 0;
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

// nudges a character out of any solid tile it's currently overlapping by
// snapping its collision box to the closest free position. returns true when
// the character was actually moved. no-op when already free or when the grid
// contains no reachable free spot within the search radius.
export function resolveCharacterCollision(char: BasicCharacter, grid: SolidGrid): boolean {
	const before = characterAabb(char);
	const after = findNearestFreeAabb(grid, before);
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
