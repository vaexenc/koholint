import type {Camera, ViewBounds} from "@/client/viewport/camera";
import {ZOOM_STEP} from "@/client/viewport/camera";
import type {PointerEvent, MouseEvent as ReactMouseEvent, WheelEvent} from "react";

// pointer travel under this many CSS pixels between down and up is treated
// as a click (teleport) rather than a drag (pan).
const CLICK_MAX_TRAVEL_PX = 4;
// a steer release this quick (and within CLICK_MAX_TRAVEL_PX) still counts as
// a tap/click. steering engages instantly on press for zero input lag, so a
// tap steers for a few ticks first — harmless, since where a click means
// teleport the teleport overrides the position anyway.
const TAP_MAX_MS = 200;

type Drag = {
	pointerId: number;
	button: number;
	startX: number;
	startY: number;
	startOffsetX: number;
	startOffsetY: number;
};

// two-finger pinch session: the scale/distance baseline it started from and
// the world point under the fingers' midpoint, kept pinned there while the
// gesture zooms and pans.
type Pinch = {
	startDist: number;
	startScale: number;
	worldX: number;
	worldY: number;
};

// hold-to-walk session (single touch, or left mouse/pen with click-to-move).
// steers from the moment of the press; the start pose/time only serve to
// reclassify a quick, still release as a tap (click) on the way out.
type Steer = {
	pointerId: number;
	startX: number;
	startY: number;
	startTime: number;
};

export type GestureDeps = {
	readonly camera: Camera;
	// null until the map has loaded, when there is nothing to clamp against.
	readonly bounds: () => ViewBounds | null;
	readonly clampScale: (scale: number) => number;
	// while the camera is locked to the player the follow spring overrides any
	// drag, so panning and the grab cursor are both off.
	readonly following: () => boolean;
	// routes the left mouse/pen button to steering instead of panning.
	readonly clickToMove: () => boolean;
	// feeds the hold-to-walk channel; null ends the gesture. every game exposes
	// one, so this only no-ops in the window before a map has finished loading.
	readonly steerTo: (point: {x: number; y: number} | null) => void;
	readonly onTileClick: (clientX: number, clientY: number) => void;
	readonly onDraggingChange: (dragging: boolean) => void;
};

// the canvas' pointer/wheel state machine: camera panning, pinch zoom, wheel
// zoom, hold-to-walk steering, and the tap/click that means "teleport there".
// it owns which gesture a pointer currently belongs to; everything it decides
// is written straight into the Camera, so the render loop reads no gesture
// state at all.
export class MapGestures {
	// null until the hook has wired it up, one effect after mount — before that
	// there is no camera to move and no canvas the user could have touched.
	private deps: GestureDeps | null = null;
	// every pointer currently down on the canvas, in press order (Map preserves
	// insertion, so the first two entries are the pinch pair).
	private readonly pointers = new Map<number, {x: number; y: number}>();
	private drag: Drag | null = null;
	private pinch: Pinch | null = null;
	private steer: Steer | null = null;
	// true from the moment a gesture gains a second finger until every finger
	// lifts, so no phase of a pinch can end in a tile click.
	private multiTouch = false;

	// re-pointed after every render, so the handlers always see current config
	// without being re-bound to the canvas.
	configure(deps: GestureDeps): void {
		this.deps = deps;
	}

	// a torn-down map takes the whole gesture state with it. this instance
	// outlives the session it was configured for, so anything left behind — a
	// released steer, a tracked pointer, a half-finished pinch — would be read as
	// live by the next map's first press.
	dispose(): void {
		this.endSteer();
		this.setDrag(null);
		this.pointers.clear();
		this.pinch = null;
		this.multiTouch = false;
	}

	onPointerDown = (e: PointerEvent<HTMLCanvasElement>): void => {
		if (!this.deps) return;
		const {camera, clickToMove, steerTo} = this.deps;
		camera.settle();
		e.currentTarget.setPointerCapture(e.pointerId);
		this.pointers.set(e.pointerId, {x: e.clientX, y: e.clientY});
		if (this.pointers.size === 2) {
			// a second finger turns the gesture into a pinch (zoom + pan around
			// the midpoint) for the rest of it, ending any drag or steer.
			this.multiTouch = true;
			this.endSteer();
			this.setDrag(null);
			this.pinch = this.capturePinch();
			return;
		}
		if (this.pointers.size > 2) return;
		// hold-to-walk: a single touch always steers the character — camera
		// panning stays on two fingers there — and the left mouse/pen button
		// steers when click-to-move is on, leaving panning to the other buttons.
		// steering starts on the press itself.
		if (e.pointerType === "touch" || (clickToMove() && e.button === 0)) {
			this.endSteer();
			this.steer = {
				pointerId: e.pointerId,
				startX: e.clientX,
				startY: e.clientY,
				startTime: performance.now(),
			};
			steerTo({x: e.clientX, y: e.clientY});
			return;
		}
		this.setDrag({
			pointerId: e.pointerId,
			button: e.button,
			startX: e.clientX,
			startY: e.clientY,
			startOffsetX: camera.offsetX,
			startOffsetY: camera.offsetY,
		});
	};

	onPointerMove = (e: PointerEvent<HTMLCanvasElement>): void => {
		if (!this.deps) return;
		const {camera, bounds, steerTo} = this.deps;
		const tracked = this.pointers.get(e.pointerId);
		if (tracked) {
			tracked.x = e.clientX;
			tracked.y = e.clientY;
		}
		if (this.steer?.pointerId === e.pointerId) {
			steerTo({x: e.clientX, y: e.clientY});
			return;
		}
		if (this.pinch) {
			this.movePinch(this.pinch);
			return;
		}
		if (this.drag?.pointerId === e.pointerId) {
			camera.panTo(
				this.drag.startOffsetX + (e.clientX - this.drag.startX),
				this.drag.startOffsetY + (e.clientY - this.drag.startY),
				bounds()
			);
		}
	};

	onPointerUp = (e: PointerEvent<HTMLCanvasElement>): void => {
		if (!this.deps) return;
		const wasMultiTouch = this.multiTouch;
		this.pointers.delete(e.pointerId);
		if (this.pointers.size === 0) this.multiTouch = false;
		const steer = this.steer;
		if (steer?.pointerId === e.pointerId) {
			this.endSteer();
			e.currentTarget.releasePointerCapture(e.pointerId);
			// a quick, still press is a tap — the click the mouse path would
			// deliver. a longer hold was a walk, so those never click.
			const quick = performance.now() - steer.startTime < TAP_MAX_MS;
			const still = travel(e, steer) <= CLICK_MAX_TRAVEL_PX;
			if (quick && still) this.clickAt(e);
			return;
		}
		if (this.pinch) {
			// a finger changed: re-baseline with the remaining pair, or fall
			// back to a plain pan under the last finger.
			this.pinch = this.capturePinch();
			if (this.pinch) return;
			const [rest] = [...this.pointers.entries()];
			if (rest)
				this.setDrag({
					pointerId: rest[0],
					button: 0,
					startX: rest[1].x,
					startY: rest[1].y,
					startOffsetX: this.deps.camera.offsetX,
					startOffsetY: this.deps.camera.offsetY,
				});
			return;
		}
		const drag = this.drag;
		if (drag?.pointerId !== e.pointerId) return;
		this.setDrag(null);
		e.currentTarget.releasePointerCapture(e.pointerId);
		// no phase of a multi-touch gesture is a click, even the trailing
		// single-finger pan after a pinch.
		if (wasMultiTouch || drag.button !== 0 || travel(e, drag) > CLICK_MAX_TRAVEL_PX) return;
		this.clickAt(e);
	};

	// the one place a pointer release becomes a tile click. pointercancel is
	// routed into onPointerUp so every gesture unwinds the same way, but a
	// cancelled pointer is not a release — no path may end in a click. stating
	// that here rather than on each path is what keeps the two in step.
	private clickAt(e: PointerEvent<HTMLCanvasElement>): void {
		if (e.type !== "pointerup") return;
		this.deps?.onTileClick(e.clientX, e.clientY);
	}

	onWheel = (e: WheelEvent<HTMLCanvasElement>): void => {
		if (!this.deps) return;
		const {camera, clampScale, following, bounds} = this.deps;
		const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
		const scale = clampScale(camera.targetScale * factor);
		if (scale === camera.targetScale) return;
		camera.targetScale = scale;
		// following keeps the camera centered on the player, so just change the
		// zoom level and let the follow logic place the offset.
		if (following()) {
			camera.zoomAnchor = null;
			return;
		}
		// anchor the zoom to the world point under the cursor on the LIVE camera —
		// what the user actually sees there. the render loop pins this point across
		// every in-between scale, so the focal point neither drifts during the zoom
		// nor snaps when it settles. recapturing each tick is stable because the
		// live offset already keeps this same point under the cursor.
		camera.anchorAt(e.clientX, e.clientY);
		const anchor = camera.zoomAnchor;
		if (!anchor) return;
		// targetScale is `scale` now, so this places the target offset for the
		// scale the spring is heading to.
		camera.targetOffsetX = anchor.screenX - anchor.worldX * scale;
		camera.targetOffsetY = anchor.screenY - anchor.worldY * scale;
		const limits = bounds();
		if (limits) camera.clampTarget(limits);
	};

	// no context menu while a hold-to-walk gesture is active (Android fires it
	// on touch long-press, desktop on right-click mid-steer); plain right-clicks
	// stay untouched.
	onContextMenu = (e: ReactMouseEvent<HTMLCanvasElement>): void => {
		if (this.steer) e.preventDefault();
	};

	private movePinch(pinch: Pinch): void {
		if (!this.deps) return;
		const {camera, clampScale, following, bounds} = this.deps;
		const [a, b] = [...this.pointers.values()];
		if (!a || !b) return;
		const dist = Math.hypot(a.x - b.x, a.y - b.y);
		const scale = clampScale((pinch.startScale * dist) / pinch.startDist);
		// direct manipulation like the drag: write current and target together
		// so the map tracks the fingers 1:1 with no smoothing lag.
		camera.scale = scale;
		camera.targetScale = scale;
		// following keeps the camera centered on the player, so the pinch only
		// zooms; the follow logic places the offset.
		if (following()) return;
		camera.panTo(
			(a.x + b.x) / 2 - pinch.worldX * scale,
			(a.y + b.y) / 2 - pinch.worldY * scale,
			bounds()
		);
	}

	// baseline for a (re)starting pinch: the current distance between the two
	// tracked fingers and the world point under their midpoint. re-derived
	// whenever the finger set changes so the map never jumps mid-gesture.
	private capturePinch(): Pinch | null {
		if (!this.deps) return null;
		const [a, b] = [...this.pointers.values()];
		if (!a || !b) return null;
		const {camera} = this.deps;
		const [worldX, worldY] = camera.toWorld((a.x + b.x) / 2, (a.y + b.y) / 2);
		return {
			startDist: Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1),
			startScale: camera.scale,
			worldX,
			worldY,
		};
	}

	private setDrag(drag: Drag | null): void {
		this.drag = drag;
		this.deps?.onDraggingChange(drag !== null);
	}

	private endSteer(): void {
		if (!this.steer) return;
		this.deps?.steerTo(null);
		this.steer = null;
	}
}

function travel(e: {clientX: number; clientY: number}, from: {startX: number; startY: number}) {
	return Math.hypot(e.clientX - from.startX, e.clientY - from.startY);
}
