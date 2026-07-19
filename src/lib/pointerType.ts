// whether the device's primary pointer is coarse (touchscreen) rather than
// fine (mouse/trackpad) — for wording like "tap" vs "click".
export function hasCoarsePointer(): boolean {
	return window.matchMedia("(pointer: coarse)").matches;
}
