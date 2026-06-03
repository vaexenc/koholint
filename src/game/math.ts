// linear interpolation. uses the `a + (b - a) * t` form (not `a*(1-t) + b*t`)
// so the result is bit-identical to the hand-rolled expressions this replaced
// across render, physics, and netcode, and so t outside [0, 1] extrapolates
// predictably.
export function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}
