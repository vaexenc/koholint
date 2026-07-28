import {getStored, setStored} from "@/client/lib/safeStorage";
import {interpolatedSpriteFocus, type FollowTarget} from "@/client/session/gameHost";
import {
	Camera,
	CAMERA_SMOOTHING,
	clampScale,
	INITIAL_SCALE,
	KEY_ZOOM_RATE_PER_SEC,
	type ViewBounds,
} from "@/client/viewport/camera";

// every per-frame decision about where the camera looks: what the zoom keys and
// the caps do to it, which point it chases, how the overlay insets move the
// region it must cover, and what gets reported or persisted along the way.
// camera.ts owns the math and the pose; this owns the policy driving it, so the
// render loop is left with drawing.

// floor between onViewChange reports; changes during a zoom gesture coalesce.
const VIEW_REPORT_MIN_INTERVAL_MS = 250;
// how long the zoom has to hold still before it's written back. a wheel spring,
// a held zoom key and a pinch all settle into a single write this way.
const ZOOM_STORE_DELAY_MS = 500;
// one slot for every route: zoom is a viewing preference rather than a per-map
// one, so it also carries across the online/offline switch.
const ZOOM_STORAGE_KEY = "koholint:zoom";

// CSS pixels along each window side edge covered by overlay UI (the chat
// panel). edge clamping treats only the remaining strip as the viewport, so
// the map can pan out from under the overlay at that edge; centering still
// anchors to the full window.
export type Insets = {left: number; right: number};

// the caps in force on a route. spelled structurally so the live parameter bag
// satisfies it as-is, without the policy having to know what else is in there.
export type ZoomLimits = {
	readonly maxViewWorldPx: number | null;
	readonly maxZoom: number | null;
};

// the zoom limits move with the window and with the caps being applied or
// lifted (admin status arrives after the map does), so every clamp re-reads
// them rather than capturing a range.
export function clampScaleFor(limits: ZoomLimits, scale: number): number {
	return clampScale(scale, limits.maxViewWorldPx, limits.maxZoom);
}

// this frame's share of the camera spring: the fraction of the remaining
// distance every eased value closes. frame-rate independent, so the camera
// settles in the same wall-clock time at any refresh rate.
export function smoothingFactor(dt: number): number {
	return dt > 0 ? 1 - Math.exp(-CAMERA_SMOOTHING * dt) : 0;
}

// the region the camera clamps the map to cover: the window minus the overlay
// insets on x, the whole window on y. the right edge is kept >= the left for
// degenerate windows narrower than the overlays.
export function viewBounds(mapWidth: number, mapHeight: number, insets: Insets): ViewBounds {
	return {
		mapWidth,
		mapHeight,
		left: insets.left,
		right: Math.max(insets.left, window.innerWidth - insets.right),
		top: 0,
		bottom: window.innerHeight,
	};
}

// eases the overlay insets toward their live values with the same spring
// constant as the camera, so showing/hiding/resizing/side-switching the chat
// panel moves the clamp limits — and with them the camera — smoothly instead of
// snapping. mutates `eased` in place; it is the value the camera math reads.
export function easeInsets(eased: Insets, live: Insets, k: number): void {
	eased.left += (live.left - eased.left) * k;
	eased.right += (live.right - eased.right) * k;
	// snap at sub-pixel distance so the spring doesn't tail off into noise.
	if (Math.abs(live.left - eased.left) < 0.25) eased.left = live.left;
	if (Math.abs(live.right - eased.right) < 0.25) eased.right = live.right;
}

// held keyboard zoom scales the target exponentially with time, so the zoom
// feels constant-speed at every scale. when not following it anchors to the
// viewport center — the keyboard has no cursor point to pin, and re-anchoring
// each frame (like the wheel does per event) keeps the center pinned through
// the spring.
export function applyKeyboardZoom(
	camera: Camera,
	dir: number,
	dt: number,
	following: boolean
): void {
	if (dir === 0 || dt <= 0) return;
	const next = camera.targetScale * Math.pow(KEY_ZOOM_RATE_PER_SEC, dir * dt);
	if (next === camera.targetScale) return;
	camera.targetScale = next;
	if (following) camera.zoomAnchor = null;
	else camera.anchorAt(window.innerWidth / 2, window.innerHeight / 2);
}

// one frame of camera-offset motion: chasing the followed character, holding a
// zoom's anchor point, or plain spring toward the target — in that order of
// precedence, since each overrides the one after it.
export function advanceCameraOffset(
	camera: Camera,
	followTarget: FollowTarget | null,
	alpha: number,
	k: number,
	bounds: ViewBounds
): void {
	if (followTarget) {
		// a zoom while following stays centered on the player, so a pending
		// cursor anchor is moot.
		camera.zoomAnchor = null;
		const focus = interpolatedSpriteFocus(followTarget, alpha);
		camera.easeFollow(focus.x, focus.y, k, bounds);
		return;
	}
	// not following: forget the focus so re-enabling follow eases from wherever
	// the camera currently looks rather than a stale point.
	camera.followFocus = null;
	const anchor = camera.zoomAnchor;
	if (!anchor) {
		camera.easeOffset(k);
		return;
	}
	camera.pinToAnchor(anchor);
	if (camera.scale === camera.targetScale) camera.zoomAnchor = null;
}

// reports the viewport's world extent from the wider of the live and target
// scale: a zoom-out widens the report before the spring settles, and
// mid-zoom-in the still-wide live view keeps its coverage until the spring
// actually shrinks it. re-fires only on meaningful change, at most a few times
// a second. the last report is the reporter's own state, so the caller just
// calls it every frame.
export function createViewReporter(
	onViewChange: ((w: number, h: number) => void) | undefined
): (camera: Camera, now: number) => void {
	let prev: {w: number; h: number; at: number} | null = null;
	return (camera, now) => {
		if (!onViewChange) return;
		const reportScale = Math.min(camera.scale, camera.targetScale);
		const w = window.innerWidth / reportScale;
		const h = window.innerHeight / reportScale;
		const changed =
			!prev || Math.abs(w - prev.w) > prev.w * 0.02 || Math.abs(h - prev.h) > prev.h * 0.02;
		if (!changed || (prev && now - prev.at <= VIEW_REPORT_MIN_INTERVAL_MS)) return;
		onViewChange(w, h);
		prev = {w, h, at: now};
	};
}

// last zoom this browser settled on, for the camera to open at. out-of-range or
// unparseable values fall back to the default rather than fighting the clamps.
export function loadStoredZoom(): number {
	const stored = getStored(ZOOM_STORAGE_KEY);
	const scale = stored === null ? NaN : Number(stored);
	return Number.isFinite(scale) ? scale : INITIAL_SCALE;
}

// writes the zoom back to storage once it holds still, so a whole gesture —
// wheel spring, held key, or pinch, all of which change the scale over many
// frames — costs one write instead of one per frame. a session that never zooms
// never writes: nothing is pending until the scale actually moves.
export function createZoomPersister(initialScale: number): (scale: number, now: number) => void {
	let settling = initialScale;
	// 0 means nothing pending.
	let dueAt = 0;
	return (scale, now) => {
		if (scale !== settling) {
			settling = scale;
			dueAt = now + ZOOM_STORE_DELAY_MS;
			return;
		}
		if (dueAt === 0 || now < dueAt) return;
		dueAt = 0;
		setStored(ZOOM_STORAGE_KEY, String(scale));
	};
}
