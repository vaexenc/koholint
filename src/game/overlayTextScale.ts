// above-head overlay text (name tags, chat bubbles) draws in CSS pixels, so
// it wouldn't grow with the camera on its own. scale it with zoom relative to
// the initial camera scale, clamped so it stays readable when zoomed far out
// and doesn't swallow the screen when zoomed far in.

// the camera scale at which overlay text renders at its base size; matches
// INITIAL_SCALE in useMapRenderer.
const REFERENCE_ZOOM = 3;
const MIN_SCALE = 0.6;
const MAX_SCALE = 3;

export function overlayTextScale(zoom: number): number {
	return Math.min(MAX_SCALE, Math.max(MIN_SCALE, zoom / REFERENCE_ZOOM));
}
