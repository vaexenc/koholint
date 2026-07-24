import {DEFAULT_KEY_BINDINGS, type KeyBindings} from "@/game";

// movement input preferences are user-level, not per-map settings, so every
// route shares these localStorage slots.
export const MOVEMENT_BINDINGS_KEY = "koholint:movementBindings";
export const CLICK_TO_MOVE_KEY = "koholint:clickToMove";
const MOVEMENT_KEYS_PER_ACTION = 2;

export type MovementAction = keyof KeyBindings;
const MOVEMENT_ACTIONS: readonly MovementAction[] = [
	"up",
	"down",
	"left",
	"right",
	"zoomIn",
	"zoomOut",
];

// one editor cell: `slot` is the column (0 or 1) within the action's row.
export type MovementSlot = {action: MovementAction; slot: number};

// the stored payload is untyped json; anything malformed falls back to the
// defaults wholesale so the actions always stay consistent with each other.
// keys are lowercased, deduped across actions, and capped per action. the zoom
// actions are newer than stored payloads may be: when absent they take their
// defaults (minus keys the movement rows already claimed) instead of voiding
// the user's movement setup.
export function sanitizeMovementBindings(value: unknown): KeyBindings {
	if (value === null || typeof value !== "object") return DEFAULT_KEY_BINDINGS;
	const seen = new Set<string>();
	const up = readKeys(Reflect.get(value, "up"), seen);
	const down = readKeys(Reflect.get(value, "down"), seen);
	const left = readKeys(Reflect.get(value, "left"), seen);
	const right = readKeys(Reflect.get(value, "right"), seen);
	if (!up || !down || !left || !right) return DEFAULT_KEY_BINDINGS;
	const zoomIn = readKeys(Reflect.get(value, "zoomIn") ?? DEFAULT_KEY_BINDINGS.zoomIn, seen);
	const zoomOut = readKeys(Reflect.get(value, "zoomOut") ?? DEFAULT_KEY_BINDINGS.zoomOut, seen);
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
// action) held it before, so a key never drives two directions. cells keep
// their position during the move and compact left afterwards.
export function assignMovementKey(
	bindings: KeyBindings,
	target: MovementSlot,
	key: string
): KeyBindings {
	const slots = toSlots(bindings);
	for (const action of MOVEMENT_ACTIONS) {
		const actionSlots = slots[action];
		for (let i = 0; i < actionSlots.length; i++) {
			if (actionSlots[i] === key) actionSlots[i] = null;
		}
	}
	slots[target.action][target.slot] = key;
	return fromSlots(slots);
}

export function clearMovementKey(bindings: KeyBindings, target: MovementSlot): KeyBindings {
	const slots = toSlots(bindings);
	slots[target.action][target.slot] = null;
	return fromSlots(slots);
}

type SlotMap = Record<MovementAction, (string | null)[]>;

function toSlots(bindings: KeyBindings): SlotMap {
	return {
		up: movementSlots(bindings, "up"),
		down: movementSlots(bindings, "down"),
		left: movementSlots(bindings, "left"),
		right: movementSlots(bindings, "right"),
		zoomIn: movementSlots(bindings, "zoomIn"),
		zoomOut: movementSlots(bindings, "zoomOut"),
	};
}

function fromSlots(slots: SlotMap): KeyBindings {
	const compact = (keys: (string | null)[]) => keys.filter((key) => key !== null);
	return {
		up: compact(slots.up),
		down: compact(slots.down),
		left: compact(slots.left),
		right: compact(slots.right),
		zoomIn: compact(slots.zoomIn),
		zoomOut: compact(slots.zoomOut),
	};
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
