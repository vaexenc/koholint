import {NEUTRAL_INPUT, type CharacterInput, type Direction} from "./types";

// the abstract input source per entity. server and client both read from one
// of these every tick. for the network case the wire layer will implement
// this by buffering inputs received from a remote player.
export interface InputProvider {
	sample(tick: number, dtSec: number): CharacterInput;
	dispose?(): void;
}

export class StaticInputProvider implements InputProvider {
	private input: CharacterInput;
	constructor(input: CharacterInput = NEUTRAL_INPUT) {
		this.input = input;
	}
	setInput(input: CharacterInput): void {
		this.input = input;
	}
	sample(): CharacterInput {
		return this.input;
	}
}

// merges several sources into one input: a direction is pressed if any source
// presses it. lets keyboard and touch drive the same character.
export class CompositeInputProvider implements InputProvider {
	private providers: readonly InputProvider[];
	constructor(providers: readonly InputProvider[]) {
		this.providers = providers;
	}
	sample(tick: number, dtSec: number): CharacterInput {
		let up = false;
		let down = false;
		let left = false;
		let right = false;
		for (const provider of this.providers) {
			const input = provider.sample(tick, dtSec);
			up = up || input.up;
			down = down || input.down;
			left = left || input.left;
			right = right || input.right;
		}
		return {up, down, left, right};
	}
	dispose(): void {
		for (const provider of this.providers) provider.dispose?.();
	}
}

export type PointerSteerDeps = {
	// projects a client-space (CSS px) point into world coordinates under the
	// live camera.
	readonly screenToWorld: (x: number, y: number) => readonly [number, number];
	// world-space point the character steers from (its collision-box center).
	readonly origin: () => {x: number; y: number};
};

// axis distances under this many world pixels don't steer, so the character
// settles under the pointer instead of oscillating around it.
const STEER_DEAD_ZONE_PX = 6;

// hold-to-walk: drives the character toward a held pointer (finger or mouse
// button). the renderer feeds pointer positions in screen space; every sample
// re-projects them through the live camera, so steering stays true while the
// camera follows the walking character. per-axis thresholds give 8-way
// movement — diagonal from afar, axis-aligned once the other axis closes in.
export class PointerSteerInputProvider implements InputProvider {
	private deps: PointerSteerDeps;
	private screen: {x: number; y: number} | null = null;
	// lets the page suspend steering (e.g. while a modal is open) without the
	// renderer having to know; dropping the target stops movement immediately.
	private enabled = true;
	// whether steering has ever moved the character — read by the movement hint.
	private steered = false;

	constructor(deps: PointerSteerDeps) {
		this.deps = deps;
	}

	setScreenTarget(point: {x: number; y: number} | null): void {
		this.screen = point === null ? null : {x: point.x, y: point.y};
	}

	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
		if (!enabled) this.screen = null;
	}

	hasSteered(): boolean {
		return this.steered;
	}

	sample(): CharacterInput {
		if (!this.enabled || this.screen === null) return NEUTRAL_INPUT;
		const [worldX, worldY] = this.deps.screenToWorld(this.screen.x, this.screen.y);
		const origin = this.deps.origin();
		const dx = worldX - origin.x;
		const dy = worldY - origin.y;
		const input = {
			up: dy < -STEER_DEAD_ZONE_PX,
			down: dy > STEER_DEAD_ZONE_PX,
			left: dx < -STEER_DEAD_ZONE_PX,
			right: dx > STEER_DEAD_ZONE_PX,
		};
		if (input.up || input.down || input.left || input.right) this.steered = true;
		return input;
	}
}

export type KeyBindings = {
	readonly up: readonly string[];
	readonly down: readonly string[];
	readonly left: readonly string[];
	readonly right: readonly string[];
};

export const DEFAULT_KEY_BINDINGS: KeyBindings = {
	up: ["w", "arrowup"],
	down: ["s", "arrowdown"],
	left: ["a", "arrowleft"],
	right: ["d", "arrowright"],
};

const DIRECTIONS: readonly Direction[] = ["up", "down", "left", "right"];
const RANDOM_MIN_HOLD_MS = 300;
const RANDOM_MAX_HOLD_MS = 1500;
// chance to idle instead of pressing a direction at each decision point.
const RANDOM_IDLE_CHANCE = 0.2;

// rolls a fresh decision (one direction or idle) at random intervals. fully
// drives a character with no human input — used here for the npc instance.
export class RandomInputProvider implements InputProvider {
	private current: CharacterInput = NEUTRAL_INPUT;
	private holdRemainingMs = 0;
	private rng: () => number;

	constructor(rng: () => number = Math.random) {
		this.rng = rng;
	}

	sample(_tick: number, dtSec: number): CharacterInput {
		this.holdRemainingMs -= dtSec * 1000;
		if (this.holdRemainingMs <= 0) {
			this.current = this.pickInput();
			this.holdRemainingMs =
				RANDOM_MIN_HOLD_MS + this.rng() * (RANDOM_MAX_HOLD_MS - RANDOM_MIN_HOLD_MS);
		}
		return this.current;
	}

	private pickInput(): CharacterInput {
		if (this.rng() < RANDOM_IDLE_CHANCE) return NEUTRAL_INPUT;
		const dir = DIRECTIONS[Math.floor(this.rng() * DIRECTIONS.length)];
		return {
			up: dir === "up",
			down: dir === "down",
			left: dir === "left",
			right: dir === "right",
		};
	}
}
