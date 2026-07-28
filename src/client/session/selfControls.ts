import {KeyboardInputProvider} from "@/client/game";
import {
	CompositeInputProvider,
	PointerSteerInputProvider,
	type InputProvider,
	type KeyBindings,
	type PointerSteerDeps,
} from "@/shared/game";

// the local player's input channels behind one handle: the keyboard and the
// hold-to-walk pointer, merged into the single provider the world samples.
// both map games drive their character through exactly this set, so it is
// built, suspended and rebound here rather than in two constructors that would
// have to stay in step — and the page layer can hold the whole thing without
// the individual providers having to sit on the games' shared contract.
export class SelfControls {
	// what World.addCharacter binds to the character.
	readonly provider: InputProvider;
	private readonly keyboard = new KeyboardInputProvider();
	private readonly steer: PointerSteerInputProvider;

	constructor(deps: PointerSteerDeps) {
		this.steer = new PointerSteerInputProvider(deps);
		this.provider = new CompositeInputProvider([this.keyboard, this.steer]);
	}

	// suspends/resumes every player input source at once (e.g. while a modal is
	// open). one call rather than two is the point: a channel added here can't be
	// left un-suspended by a caller that didn't know about it.
	setEnabled(enabled: boolean): void {
		this.keyboard.setEnabled(enabled);
		this.steer.setEnabled(enabled);
	}

	setBindings(bindings: KeyBindings): void {
		this.keyboard.setBindings(bindings);
	}

	// the pointer position (client CSS px) of a hold-to-walk gesture; null ends it.
	setScreenTarget(point: {x: number; y: number} | null): void {
		this.steer.setScreenTarget(point);
	}

	// held keyboard-zoom direction: +1 in, -1 out, 0 idle.
	zoomInput(): number {
		return this.keyboard.zoomInput();
	}

	// the two signals the movement hint reads to know it has done its job.
	seenKeys(): ReadonlySet<string> {
		return this.keyboard.getSeenKeys();
	}

	hasSteered(): boolean {
		return this.steer.hasSteered();
	}
}
