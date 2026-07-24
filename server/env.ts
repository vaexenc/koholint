import {log} from "./log";

// numeric env knob with a fallback. anything that isn't a positive integer is
// rejected loudly rather than passed through: `Number("oops")` is NaN, and a NaN
// cap silently disables every comparison it guards.
export function envInt(name: string, fallback: number): number {
	const raw = process.env[name];
	if (raw === undefined || raw.trim() === "") return fallback;
	const value = Number(raw);
	if (!Number.isInteger(value) || value <= 0) {
		log.warn(`env: ${name}="${raw}" is not a positive integer, falling back to ${fallback}`);
		return fallback;
	}
	return value;
}
