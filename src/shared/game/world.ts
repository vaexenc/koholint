import {resolveCharacterCollision, type BasicCharacter} from "./character";
import {stepCharacter} from "./characterStep";
import type {InputProvider} from "./controllers";
import type {WorldGrids} from "./grids";
import {NEUTRAL_INPUT, type CharacterInput, type EntityId} from "./types";

// the authoritative simulation. step() samples each entity's input provider
// for the tick and feeds the inputs into applyInputs(). splitting the two
// lets a future server bypass sample() and call applyInputs() directly with
// inputs received from the wire, while the client can still tick locally
// for prediction.
export class World {
	readonly characters = new Map<EntityId, BasicCharacter>();
	readonly grids: WorldGrids;
	private inputProviders = new Map<EntityId, InputProvider>();

	constructor(grids: WorldGrids) {
		this.grids = grids;
	}

	addCharacter(character: BasicCharacter, inputProvider: InputProvider): void {
		resolveCharacterCollision(character, this.grids);
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
		for (const [id, char] of this.characters)
			this.stepOne(char, inputs.get(id) ?? NEUTRAL_INPUT, dtSec);
	}

	// steps a single character against this world's grids. also serves prediction
	// replay, which re-steps the local character outside the tick loop.
	stepOne(character: BasicCharacter, input: CharacterInput, dtSec: number): void {
		stepCharacter(character, input, dtSec, this.grids);
	}
}
