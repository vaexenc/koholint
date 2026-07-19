// whether the device's primary pointer is coarse (touchscreen) rather than
// fine (mouse/trackpad) — for wording like "tap" vs "click", or hiding
// keyboard-only affordances. useHasCoarsePointer is the reactive variant.
export const COARSE_POINTER_QUERY = "(pointer: coarse)";

export function hasCoarsePointer(): boolean {
	return window.matchMedia(COARSE_POINTER_QUERY).matches;
}
