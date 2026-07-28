import {DEFAULT_KEY_BINDINGS, type KeyBindings} from "@/shared/game";
import {isRecord} from "@/shared/lib/isRecord";

// movement input preferences are user-level, not per-map settings, so every
// route shares these localStorage slots.
export const MOVEMENT_BINDINGS_KEY = "koholint:movementBindings";
export const CLICK_TO_MOVE_KEY = "koholint:clickToMove";
const MOVEMENT_KEYS_PER_ACTION = 2;

export type MovementAction = keyof KeyBindings;

// the one enumeration of the actions. spelling them out (rather than deriving a
// list at runtime) is what makes the compiler catch an action added to
// KeyBindings, since the returned record has to be complete — and building the
// action list off the same call means it can't fall behind either.
function mapActions<T>(fn: (action: MovementAction) => T): Record<MovementAction, T> {
	return {
		up: fn("up"),
		down: fn("down"),
		left: fn("left"),
		right: fn("right"),
		zoomIn: fn("zoomIn"),
		zoomOut: fn("zoomOut"),
	};
}

const MOVEMENT_ACTIONS: readonly MovementAction[] = Object.values(mapActions((action) => action));

// one editor cell: `slot` is the column (0 or 1) within the action's row.
export type MovementSlot = {action: MovementAction; slot: number};

// the stored payload is untyped json; anything malformed falls back to the
// defaults wholesale so the actions always stay consistent with each other.
// keys are lowercased, deduped across actions, and capped per action. the zoom
// actions are newer than stored payloads may be: when absent they take their
// defaults (minus keys the movement rows already claimed) instead of voiding
// the user's movement setup.
export function sanitizeMovementBindings(value: unknown): KeyBindings {
	if (!isRecord(value)) return DEFAULT_KEY_BINDINGS;
	const seen = new Set<string>();
	const up = readKeys(value.up, seen);
	const down = readKeys(value.down, seen);
	const left = readKeys(value.left, seen);
	const right = readKeys(value.right, seen);
	if (!up || !down || !left || !right) return DEFAULT_KEY_BINDINGS;
	const zoomIn = readKeys(value.zoomIn ?? DEFAULT_KEY_BINDINGS.zoomIn, seen);
	const zoomOut = readKeys(value.zoomOut ?? DEFAULT_KEY_BINDINGS.zoomOut, seen);
	if (!zoomIn || !zoomOut) return DEFAULT_KEY_BINDINGS;
	return {up, down, left, right, zoomIn, zoomOut};
}

function readKeys(value: unknown, seen: Set<string>): string[] | null {
	if (!Array.isArray(value)) return null;
	const keys: string[] = [];
	for (const entry of value) {
		if (typeof entry !== "string") return null;
		const key = entry.toLowerCase();
		if (seen.has(key) || keys.length >= MOVEMENT_KEYS_PER_ACTION) continue;
		seen.add(key);
		keys.push(key);
	}
	return keys;
}

export function sameMovementBindings(a: KeyBindings, b: KeyBindings): boolean {
	return MOVEMENT_ACTIONS.every(
		(action) =>
			a[action].length === b[action].length &&
			a[action].every((key, i) => b[action][i] === key)
	);
}

// fixed-width slot view of one action for the editor grid: index = column,
// null = empty cell.
export function movementSlots(bindings: KeyBindings, action: MovementAction): (string | null)[] {
	const keys = bindings[action];
	const slots: (string | null)[] = [];
	for (let i = 0; i < MOVEMENT_KEYS_PER_ACTION; i++) slots.push(i < keys.length ? keys[i] : null);
	return slots;
}

// a captured key claims its cell exclusively: it leaves whatever cell (of any
// action) held it before, so a key never drives two directions. cells keep their
// position during the move and compact left afterwards — the removal leaves a
// hole rather than shifting its row, so a capture into an occupied cell replaces
// what was there instead of pushing it aside.
export function assignMovementKey(
	bindings: KeyBindings,
	target: MovementSlot,
	key: string
): KeyBindings {
	const slots = mapActions((action) =>
		movementSlots(bindings, action).map((k) => (k === key ? null : k))
	);
	slots[target.action][target.slot] = key;
	return mapActions((action) => compact(slots[action]));
}

// clearing a cell needs no slot view at all: a padded cell's index is the key's
// index, so nulling it and compacting is a filter by position.
export function clearMovementKey(bindings: KeyBindings, target: MovementSlot): KeyBindings {
	return mapActions((action) =>
		action === target.action
			? bindings[action].filter((_, i) => i !== target.slot)
			: bindings[action]
	);
}

function compact(slots: readonly (string | null)[]): string[] {
	return slots.filter((key) => key !== null);
}

const KEY_LABELS = new Map<string, string>([
	["arrowup", "↑"],
	["arrowdown", "↓"],
	["arrowleft", "←"],
	["arrowright", "→"],
	[" ", "Space"],
]);

// bindings store lowercased KeyboardEvent.key values; render the well-known
// ones as glyphs, single characters uppercased, and the rest in title case.
export function movementKeyLabel(key: string): string {
	const label = KEY_LABELS.get(key);
	if (label !== undefined) return label;
	if (key.length === 1) return key.toUpperCase();
	return key.charAt(0).toUpperCase() + key.slice(1);
}
