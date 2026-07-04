import {resolveCharacterCollision, stepCharacter, type BasicCharacter} from "./character";
import type {CliffGrid, HoleGrid, SolidGrid} from "./collision";
import type {InputProvider} from "./controllers";
import type {PushGrid} from "./push";
import type {TeleporterGrid} from "./teleport";
import type {TerrainGrid} from "./terrain";
import {NEUTRAL_INPUT, type CharacterInput, type EntityId} from "./types";

export type WorldOptions = {
	readonly terrain?: TerrainGrid;
	readonly holes?: HoleGrid;
	readonly cliffs?: CliffGrid;
	readonly teleporters?: TeleporterGrid;
	readonly push?: PushGrid;
};

// the authoritative simulation. step() samples each entity's input provider
// for the tick and feeds the inputs into applyInputs(). splitting the two
// lets a future server bypass sample() and call applyInputs() directly with
// inputs received from the wire, while the client can still tick locally
// for prediction.
export class World {
	readonly characters = new Map<EntityId, BasicCharacter>();
	readonly grid: SolidGrid;
	readonly terrain?: TerrainGrid;
	readonly holes?: HoleGrid;
	readonly cliffs?: CliffGrid;
	readonly teleporters?: TeleporterGrid;
	readonly push?: PushGrid;
	private inputProviders = new Map<EntityId, InputProvider>();

	constructor(grid: SolidGrid, options: WorldOptions = {}) {
		this.grid = grid;
		this.terrain = options.terrain;
		this.holes = options.holes;
		this.cliffs = options.cliffs;
		this.teleporters = options.teleporters;
		this.push = options.push;
	}

	addCharacter(character: BasicCharacter, inputProvider: InputProvider): void {
		resolveCharacterCollision(character, this.grid, this.holes);
		this.characters.set(character.id, character);
		this.inputProviders.set(character.id, inputProvider);
	}

	removeCharacter(id: EntityId): void {
		this.characters.delete(id);
		const provider = this.inputProviders.get(id);
		provider?.dispose?.();
		this.inputProviders.delete(id);
	}

	dispose(): void {
		for (const id of [...this.inputProviders.keys()]) this.removeCharacter(id);
	}

	step(tick: number, dtSec: number): void {
		const inputs = this.sampleInputs(tick, dtSec);
		this.applyInputs(inputs, dtSec);
	}

	sampleInputs(tick: number, dtSec: number): Map<EntityId, CharacterInput> {
		const inputs = new Map<EntityId, CharacterInput>();
		for (const [id, provider] of this.inputProviders)
			inputs.set(id, provider.sample(tick, dtSec));
		return inputs;
	}

	applyInputs(inputs: ReadonlyMap<EntityId, CharacterInput>, dtSec: number): void {
		for (const [id, char] of this.characters) {
			const input = inputs.get(id) ?? NEUTRAL_INPUT;
			stepCharacter(
				char,
				input,
				dtSec,
				this.grid,
				this.terrain,
				this.holes,
				this.cliffs,
				this.teleporters,
				this.push
			);
		}
	}
}
