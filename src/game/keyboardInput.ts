import {DEFAULT_KEY_BINDINGS, type InputProvider, type KeyBindings} from "./controllers";
import {NEUTRAL_INPUT, type CharacterInput} from "./types";

// <input> types that don't accept typed characters, so a movement key pressed
// while one is focused (e.g. the "follow player" checkbox) should still drive
// the player rather than being swallowed as if it were text entry.
const NON_TEXT_INPUT_TYPES = new Set([
	"button",
	"checkbox",
	"color",
	"file",
	"image",
	"radio",
	"range",
	"reset",
	"submit",
]);

// movement keys must not double as text entry: when the user is typing in a
// chat box, name field, or any editable control, the keystroke belongs to that
// control, not the player. we skip capture (and preventDefault) for these so
// the field receives the character normally. non-text inputs (checkbox, radio,
// button…) are excluded — they keep focus after a click but don't take typed
// input, so movement must keep working while one is focused.
function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	const tag = target.tagName;
	if (tag === "TEXTAREA" || tag === "SELECT") return true;
	if (tag === "INPUT") return !NON_TEXT_INPUT_TYPES.has((target as HTMLInputElement).type);
	return false;
}

// collects browser key state for one entity. owned by the player session, not
// by the world: the world only sees the sampled input each tick, which keeps
// the simulation independent of dom event timing. browser-only (it binds
// Window / KeyboardEvent listeners), so it lives apart from the DOM-free
// providers in controllers.ts — that lets the server import those without
// dragging the DOM lib into its type-check.
export class KeyboardInputProvider implements InputProvider {
	private pressed = new Set<string>();
	// every bound key pressed at least once while capturing. cumulative, never
	// cleared — read by the movement hint to know which keys the player has tried.
	private seen = new Set<string>();
	private bound: KeyBindings;
	private boundKeys: Set<string>;
	private target: Window;
	// lets the page suspend movement capture entirely (e.g. while a modal dialog
	// like the avatar picker is open) without tearing down the listeners.
	private enabled = true;

	constructor(bindings: KeyBindings = DEFAULT_KEY_BINDINGS, target: Window = window) {
		this.target = target;
		this.bound = bindings;
		this.boundKeys = boundKeySet(bindings);
		target.addEventListener("keydown", this.onKeyDown);
		target.addEventListener("keyup", this.onKeyUp);
		target.addEventListener("blur", this.onBlur);
	}

	// swaps the active bindings (e.g. edited in settings). pressed state resets —
	// a key held across the swap shouldn't keep driving movement under a mapping
	// it no longer belongs to. `seen` persists: those keys were genuinely pressed.
	setBindings(bindings: KeyBindings): void {
		this.bound = bindings;
		this.boundKeys = boundKeySet(bindings);
		this.pressed.clear();
	}

	// the bound keys pressed at least once. read live each frame; the consumer
	// decides what "learned" means rather than baking that policy in here.
	getSeenKeys(): ReadonlySet<string> {
		return this.seen;
	}

	sample(): CharacterInput {
		if (!this.enabled) return NEUTRAL_INPUT;
		return {
			up: this.anyDown(this.bound.up),
			down: this.anyDown(this.bound.down),
			left: this.anyDown(this.bound.left),
			right: this.anyDown(this.bound.right),
		};
	}

	// held zoom direction: +1 in, -1 out, 0 when neutral (or both held). read
	// per frame by the camera, which owns the zoom rate and limits.
	zoomInput(): number {
		if (!this.enabled) return 0;
		return Number(this.anyDown(this.bound.zoomIn)) - Number(this.anyDown(this.bound.zoomOut));
	}

	// suspends/resumes movement capture. clearing pressed keys on suspend stops a
	// held key from "sticking" — its keyup may land while suspended (or on the
	// dialog that stole focus), so we can't rely on receiving it.
	setEnabled(enabled: boolean): void {
		if (this.enabled === enabled) return;
		this.enabled = enabled;
		if (!enabled) this.pressed.clear();
	}

	dispose(): void {
		this.target.removeEventListener("keydown", this.onKeyDown);
		this.target.removeEventListener("keyup", this.onKeyUp);
		this.target.removeEventListener("blur", this.onBlur);
		this.pressed.clear();
	}

	private anyDown(keys: readonly string[]): boolean {
		for (const k of keys) if (this.pressed.has(k.toLowerCase())) return true;
		return false;
	}

	private onKeyDown = (e: KeyboardEvent) => {
		// while suspended, or when the key is meant for an editable control,
		// leave it for the focused element — don't capture or preventDefault.
		if (!this.enabled || isEditableTarget(e.target)) return;
		const k = e.key.toLowerCase();
		if (!this.boundKeys.has(k)) return;
		this.pressed.add(k);
		this.seen.add(k);
		// stop arrow keys from scrolling the page or stealing caret focus
		// from overlays.
		e.preventDefault();
	};

	private onKeyUp = (e: KeyboardEvent) => {
		const k = e.key.toLowerCase();
		if (!this.boundKeys.has(k)) return;
		this.pressed.delete(k);
	};

	private onBlur = () => this.pressed.clear();
}

function boundKeySet(bindings: KeyBindings): Set<string> {
	return new Set(
		[
			...bindings.up,
			...bindings.down,
			...bindings.left,
			...bindings.right,
			...bindings.zoomIn,
			...bindings.zoomOut,
		].map((k) => k.toLowerCase())
	);
}
