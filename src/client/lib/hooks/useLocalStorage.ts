import {getStored, setStored} from "@/client/lib/safeStorage";
import {useEffect, useState, type Dispatch, type SetStateAction} from "react";

// localStorage-backed useState. the slot holds untrusted json — an older build's
// shape, another tab's write, a hand-edited devtools value — so every read goes
// through `sanitize`, which maps the parsed value to a usable T or returns null
// to fall back to `initialValue`. pass a function for `initialValue` to compute
// it lazily (e.g. a random default) so it only runs when the slot is unusable.
export function useLocalStorage<T>(
	key: string,
	initialValue: T | (() => T),
	sanitize: (raw: unknown) => T | null
): [T, Dispatch<SetStateAction<T>>] {
	const [value, setValue] = useState<T>(() => readStored(key, initialValue, sanitize));
	useEffect(() => {
		setStored(key, JSON.stringify(value));
	}, [key, value]);
	return [value, setValue];
}

function readStored<T>(
	key: string,
	fallback: T | (() => T),
	sanitize: (raw: unknown) => T | null
): T {
	const stored = parseStored(key);
	const value = stored === undefined ? null : sanitize(stored);
	if (value !== null) return value;
	return fallback instanceof Function ? fallback() : fallback;
}

// undefined means "nothing usable in the slot" — no value, or one that isn't
// json. a stored json `null` is a value like any other and goes to the sanitizer.
function parseStored(key: string): unknown {
	const raw = getStored(key);
	if (raw === null) return undefined;
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

// sanitizers for the json primitives slots hold directly. richer values bring
// their own from the module that owns the type (parseProfile, chat settings,
// movement bindings).
export function storedBoolean(raw: unknown): boolean | null {
	return typeof raw === "boolean" ? raw : null;
}

// `normalize` runs on the way in, so a bound belongs to the slot rather than to
// each reader: a value stored under an older limit can't escape the current one.
export function storedNumber(
	normalize: (value: number) => number = (value) => value
): (raw: unknown) => number | null {
	return (raw) => (typeof raw === "number" && Number.isFinite(raw) ? normalize(raw) : null);
}

export function storedOneOf<T extends string>(values: readonly T[]): (raw: unknown) => T | null {
	return (raw) => values.find((value) => value === raw) ?? null;
}
