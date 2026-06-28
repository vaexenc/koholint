import {useEffect, useState, type Dispatch, type SetStateAction} from "react";

// thin localStorage-backed useState. values must be json-serializable.
// initialValue doubles as the fallback when nothing is stored or the stored
// payload fails to parse; pass a function to compute it lazily (e.g. a random
// default) so it only runs when the slot is empty. an undefined value clears
// the slot rather than writing the literal string "undefined".
export function useLocalStorage<T>(
	key: string,
	initialValue: T | (() => T)
): [T, Dispatch<SetStateAction<T>>] {
	const [value, setValue] = useState<T>(() => readStored(key, initialValue));
	useEffect(() => {
		try {
			if (value === undefined) window.localStorage.removeItem(key);
			else window.localStorage.setItem(key, JSON.stringify(value));
		} catch {
			// storage may be unavailable (quota, private mode); skip silently.
		}
	}, [key, value]);
	return [value, setValue];
}

function readStored<T>(key: string, fallback: T | (() => T)): T {
	const resolve = () => (fallback instanceof Function ? fallback() : fallback);
	try {
		const raw = window.localStorage.getItem(key);
		if (raw === null) return resolve();
		// json.parse erases the value type; trust the caller's T since this
		// slot is treated as a best-effort cache written under the same key.
		return JSON.parse(raw) as T;
	} catch {
		return resolve();
	}
}
