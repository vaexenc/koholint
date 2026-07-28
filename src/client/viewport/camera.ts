import {clamp} from "@/shared/lib/math";
import type {Aabb} from "@/shared/lib/rect";

export const INITIAL_SCALE = 3;
const MIN_SCALE = 0.5;
const MAX_SCALE = 16;
export const ZOOM_STEP = 1.15;

// above-head overlay text (name tags, chat bubbles) draws in CSS pixels, so it
// wouldn't grow with the camera on its own. this scales it with the zoom
// relative to the scale the camera opens at, clamped so the text stays readable
// zoomed far out and doesn't swallow the screen zoomed far in.
const MIN_OVERLAY_TEXT_SCALE = 0.6;
const MAX_OVERLAY_TEXT_SCALE = 3;

export function overlayTextScale(zoom: number): number {
	return clamp(zoom / INITIAL_SCALE, MIN_OVERLAY_TEXT_SCALE, MAX_OVERLAY_TEXT_SCALE);
}
// scale multiplier per second of held keyboard zoom.
export const KEY_ZOOM_RATE_PER_SEC = 3;
// per-second decay rate of the camera spring. higher = snappier.
// at 7, the camera closes ~95% of the remaining distance in ~430ms.
export const CAMERA_SMOOTHING = 7;

// the region of the window the map has to cover, plus the map's own size. the
// x strip is inset by overlay UI (the chat panel), so the map can pan out from
// under the overlay at that edge; y always spans the window.
export type ViewBounds = {
	readonly mapWidth: number;
	readonly mapHeight: number;
	readonly left: number;
	readonly right: number;
	readonly top: number;
	readonly bottom: number;
};

// the world point an in-flight zoom keeps pinned, and the screen point it is
// pinned to.
export type ZoomAnchor = {
	readonly worldX: number;
	readonly worldY: number;
	readonly screenX: number;
	readonly screenY: number;
};

// the screen point a centered world point is placed at: the window's middle,
// not the visible strip's. overlay UI shrinks the strip the map must cover
// without moving where the followed character should sit.
function anchorX(): number {
	return window.innerWidth / 2;
}

function anchorY(): number {
	return window.innerHeight / 2;
}

// constrain a camera offset (one axis) so the scaled map always covers the
// screen strip [start, end], hiding any out-of-map area there. when the map is
// smaller than the strip on this axis it can't cover it, so center it in the
// strip instead.
function clampOffset(
	offset: number,
	scale: number,
	mapPixels: number,
	start: number,
	end: number
): number {
	const scaled = mapPixels * scale;
	const viewport = end - start;
	if (scaled <= viewport) return start + (viewport - scaled) / 2;
	// offset `start` aligns the map's near edge to the strip's; the smallest
	// offset aligns the far edges. anything outside exposes the void.
	return clamp(offset, end - scaled, start);
}

// nearest world-space point (one axis) the camera can actually pin to the
// screen anchor: derive the offset that would put `center` at the anchor, run
// it through the offset clamp, and convert back to world space.
function clampCenter(
	center: number,
	scale: number,
	mapPixels: number,
	start: number,
	end: number,
	anchor: number
): number {
	return (anchor - clampOffset(anchor - center * scale, scale, mapPixels, start, end)) / scale;
}

// the zoom range in force right now. the floor rises when a view cap applies,
// so the window can never show more than `maxViewWorldPx` world pixels per axis
// whatever its size; the ceiling drops when a zoom cap applies. null lifts
// either (admins, the offline map). the floor is applied last: on a window so
// wide that its floor exceeds the ceiling, the floor must win — it upholds the
// interest-area contract with the server, while the ceiling is only cosmetic.
export function clampScale(
	scale: number,
	maxViewWorldPx: number | null,
	maxZoom: number | null
): number {
	const floor = maxViewWorldPx
		? Math.max(
				MIN_SCALE,
				window.innerWidth / maxViewWorldPx,
				window.innerHeight / maxViewWorldPx
		  )
		: MIN_SCALE;
	// deliberately not clamp(): that applies the ceiling last, and here the floor
	// has to win when the two cross.
	return Math.max(floor, Math.min(Math.min(MAX_SCALE, maxZoom ?? MAX_SCALE), scale));
}

// the camera the map is drawn through: a live pose plus the target a spring
// eases it toward, and the two pins that override that easing — the world point
// a zoom is anchored on, and the world point a follow camera is chasing.
//
// every placement writes the live and target offsets together, each derived
// from its own scale. springing an offset independently of the scale it belongs
// to is what makes a zoom's focal point drift mid-flight and snap back when the
// spring settles.
export class Camera {
	scale: number;
	offsetX = 0;
	offsetY = 0;
	targetScale: number;
	targetOffsetX = 0;
	targetOffsetY = 0;
	// null when no zoom is in flight.
	zoomAnchor: ZoomAnchor | null = null;
	// null when not following.
	followFocus: {x: number; y: number} | null = null;

	constructor(scale: number) {
		this.scale = scale;
		this.targetScale = scale;
	}

	// projects a client-space (CSS px) point into world coordinates under the
	// live camera.
	toWorld(x: number, y: number): readonly [number, number] {
		return [(x - this.offsetX) / this.scale, (y - this.offsetY) / this.scale];
	}

	// places a world point at the window center at both scales, unclamped: the
	// caller has already picked a center the clamp accepts.
	lookAt(x: number, y: number): void {
		this.offsetX = anchorX() - x * this.scale;
		this.offsetY = anchorY() - y * this.scale;
		this.targetOffsetX = anchorX() - x * this.targetScale;
		this.targetOffsetY = anchorY() - y * this.targetScale;
	}

	// same, but clamped per scale, for a cut rather than a glide: the initial
	// placement and the snap onto a player who has just appeared. the two clamps
	// below already pair each offset with the scale it belongs to, so composing
	// them is the whole of it — writing the four clamped offsets out again would
	// only be a second copy of that pairing to keep honest.
	centerOn(x: number, y: number, bounds: ViewBounds): void {
		this.lookAt(x, y);
		this.clampLive(bounds);
		this.clampTarget(bounds);
	}

	// eases the followed point toward the character in WORLD space, then derives
	// the offsets from it, so the character stays centered at every in-between
	// scale. it eases toward the nearest center the edge clamp can honor —
	// aiming at the raw character center makes the offset slam into the clamp
	// mid-flight near a map edge instead of decelerating into it.
	easeFollow(x: number, y: number, k: number, bounds: ViewBounds): void {
		const focus = this.followFocus ?? {
			x: (anchorX() - this.offsetX) / this.scale,
			y: (anchorY() - this.offsetY) / this.scale,
		};
		const {mapWidth, mapHeight, left, right, top, bottom} = bounds;
		focus.x += (clampCenter(x, this.scale, mapWidth, left, right, anchorX()) - focus.x) * k;
		focus.y += (clampCenter(y, this.scale, mapHeight, top, bottom, anchorY()) - focus.y) * k;
		this.followFocus = focus;
		this.lookAt(focus.x, focus.y);
	}

	// captures the world point currently under a screen point, so an in-flight
	// zoom can keep it there.
	anchorAt(screenX: number, screenY: number): void {
		const [worldX, worldY] = this.toWorld(screenX, screenY);
		this.zoomAnchor = {worldX, worldY, screenX, screenY};
	}

	// holds the anchored world point under its screen point at both scales.
	pinToAnchor(anchor: ZoomAnchor): void {
		this.offsetX = anchor.screenX - anchor.worldX * this.scale;
		this.offsetY = anchor.screenY - anchor.worldY * this.scale;
		this.targetOffsetX = anchor.screenX - anchor.worldX * this.targetScale;
		this.targetOffsetY = anchor.screenY - anchor.worldY * this.targetScale;
	}

	// direct manipulation (drag, pinch): live and target move together so the
	// map tracks the pointer 1:1 with no smoothing lag.
	panTo(offsetX: number, offsetY: number, bounds: ViewBounds | null): void {
		this.offsetX = bounds ? this.clampX(offsetX, this.scale, bounds) : offsetX;
		this.offsetY = bounds ? this.clampY(offsetY, this.scale, bounds) : offsetY;
		this.targetOffsetX = this.offsetX;
		this.targetOffsetY = this.offsetY;
	}

	// commits any in-flight spring to the current pose, so a gesture starts from
	// where the user actually sees the map right now.
	settle(): void {
		this.targetScale = this.scale;
		this.targetOffsetX = this.offsetX;
		this.targetOffsetY = this.offsetY;
		this.zoomAnchor = null;
	}

	// eases scale toward its target, snapping once within sub-percent distance
	// so the spring doesn't tail off into floating-point noise.
	easeScale(k: number): void {
		this.scale += (this.targetScale - this.scale) * k;
		if (Math.abs(this.targetScale - this.scale) < this.targetScale * 0.0005)
			this.scale = this.targetScale;
	}

	// eases the offsets toward their target, snapping at sub-pixel distance.
	easeOffset(k: number): void {
		this.offsetX += (this.targetOffsetX - this.offsetX) * k;
		this.offsetY += (this.targetOffsetY - this.offsetY) * k;
		if (Math.abs(this.targetOffsetX - this.offsetX) < 0.25) this.offsetX = this.targetOffsetX;
		if (Math.abs(this.targetOffsetY - this.offsetY) < 0.25) this.offsetY = this.targetOffsetY;
	}

	clampTarget(bounds: ViewBounds): void {
		this.targetOffsetX = this.clampX(this.targetOffsetX, this.targetScale, bounds);
		this.targetOffsetY = this.clampY(this.targetOffsetY, this.targetScale, bounds);
	}

	// the spring tracks a clamped target, but its in-flight scale can momentarily
	// expose the void; clamping the live offset against the live scale is what
	// keeps out-of-map area from ever being drawn.
	clampLive(bounds: ViewBounds): void {
		this.offsetX = this.clampX(this.offsetX, this.scale, bounds);
		this.offsetY = this.clampY(this.offsetY, this.scale, bounds);
	}

	// whether a drag could pan the map at all, or the clamp already leaves no
	// room on either axis (its centering case).
	canPan(bounds: ViewBounds): boolean {
		return (
			bounds.mapWidth * this.scale > bounds.right - bounds.left ||
			bounds.mapHeight * this.scale > bounds.bottom - bounds.top
		);
	}

	// the part of the map the camera can currently show, in whole world pixels
	// and clipped to the map. everything the frame composites is scoped to this,
	// so cost tracks the viewport instead of the map's size. rounded outward so
	// the blit's edges land just off screen, where their sampling edge can't show.
	visibleRect(mapWidth: number, mapHeight: number): Aabb {
		const x = clamp(Math.floor(-this.offsetX / this.scale), 0, mapWidth - 1);
		const y = clamp(Math.floor(-this.offsetY / this.scale), 0, mapHeight - 1);
		const right = clamp(
			Math.ceil((window.innerWidth - this.offsetX) / this.scale),
			x + 1,
			mapWidth
		);
		const bottom = clamp(
			Math.ceil((window.innerHeight - this.offsetY) / this.scale),
			y + 1,
			mapHeight
		);
		return {x, y, width: right - x, height: bottom - y};
	}

	private clampX(offset: number, scale: number, bounds: ViewBounds): number {
		return clampOffset(offset, scale, bounds.mapWidth, bounds.left, bounds.right);
	}

	private clampY(offset: number, scale: number, bounds: ViewBounds): number {
		return clampOffset(offset, scale, bounds.mapHeight, bounds.top, bounds.bottom);
	}
}
