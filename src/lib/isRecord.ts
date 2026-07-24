// json-shaped object guard. arrays are excluded so a json array can't pass as a
// record and then read every key as undefined.
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
