// generic numeric helpers, with no simulation, DOM or protocol knowledge — so
// the camera, the chat panel and the server's interest test can reach for them
// without importing the game. @/shared/game re-exports both for the sim's convenience.

// linear interpolation. uses the `a + (b - a) * t` form (not `a*(1-t) + b*t`)
// so the result is bit-identical to the hand-rolled expressions this replaced
// across render, physics, and netcode, and so t outside [0, 1] extrapolates
// predictably.
export function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

// the ceiling wins on an inverted range (min > max), since the max is applied
// last. callers that need the floor to win there — the camera's zoom limits,
// where a view cap can legally exceed the zoom cap — must not use this.
export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
