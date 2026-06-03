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
