import type {Aabb} from "@/shared/lib/rect";

// granularity the per-frame scratch bitmap is sized in (see fit).
const SCRATCH_STEP_PX = 256;

// composites everything world-anchored — the static map, animated tiles, the
// debug overlay, characters — into an offscreen scratch at an integer multiple
// of world pixels (the prescale: the device-pixel zoom rounded to whole),
// covering only the visible world rect. at an integer factor every texel lands
// the same size, so the 1px tile seams and uneven 3px/4px pixel columns that
// nearest-neighbor produces at fractional scales can't appear. the screen then
// gets a single smoothed "residual" blit at zoom/prescale (near 1): texel
// interiors stay crisp, texel edges blend over at most about a device pixel, and
// the pixel grid no longer visibly warps while a zoom animates through
// fractional scales. at an exactly integer zoom the residual blit degenerates to
// a pixel-exact 1:1 copy.
export class FrameCompositor {
	private readonly scratch = document.createElement("canvas");
	private readonly ctx: CanvasRenderingContext2D;
	private readonly mapWidth: number;
	private readonly mapHeight: number;

	constructor(mapWidth: number, mapHeight: number) {
		const ctx = this.scratch.getContext("2d");
		if (!ctx) throw new Error("failed to create offscreen 2d context");
		this.ctx = ctx;
		this.mapWidth = mapWidth;
		this.mapHeight = mapHeight;
	}

	// prepares the scratch for one frame and returns the context to draw the
	// world into, already in world space at the prescale.
	begin(view: Aabb, prescale: number): CanvasRenderingContext2D {
		this.fit(view, prescale);
		// resizing resets the canvas (contents and context state), so the
		// transform and clear come after it. the clear covers the whole canvas
		// because the residual blit's filtering taps pixels just past the view's
		// edge, where stale content must not linger.
		this.ctx.setTransform(1, 0, 0, 1, 0, 0);
		this.ctx.clearRect(0, 0, this.scratch.width, this.scratch.height);
		this.ctx.setTransform(prescale, 0, 0, prescale, -view.x * prescale, -view.y * prescale);
		this.ctx.imageSmoothingEnabled = false;
		return this.ctx;
	}

	// the residual blit: scale by zoom/prescale, smoothed, which carries the
	// fractional part of the zoom and the camera's sub-pixel offset, so texel
	// edges blend instead of stepping unevenly. the destination origin snaps to
	// whole device pixels — at an integer zoom that makes this a pixel-exact
	// copy, and it quantizes panning at a device pixel, exactly where nearest
	// sampling put it before.
	blit(
		target: CanvasRenderingContext2D,
		view: Aabb,
		prescale: number,
		deviceScale: number,
		offsetX: number,
		offsetY: number
	): void {
		target.setTransform(1, 0, 0, 1, 0, 0);
		target.clearRect(0, 0, target.canvas.width, target.canvas.height);
		target.imageSmoothingEnabled = true;
		target.imageSmoothingQuality = "high";
		target.drawImage(
			this.scratch,
			0,
			0,
			view.width * prescale,
			view.height * prescale,
			Math.round(view.x * deviceScale + offsetX),
			Math.round(view.y * deviceScale + offsetY),
			view.width * deviceScale,
			view.height * deviceScale
		);
	}

	// sizes the scratch to hold the visible rect at the given integer prescale.
	// quantized so a zoom or a window resize reallocates every few hundred
	// pixels rather than every frame, and capped at the full prescaled map,
	// which is the largest rect the camera can ever expose.
	private fit(view: Aabb, prescale: number): void {
		const width = Math.min(
			this.mapWidth * prescale,
			Math.ceil((view.width * prescale) / SCRATCH_STEP_PX) * SCRATCH_STEP_PX
		);
		const height = Math.min(
			this.mapHeight * prescale,
			Math.ceil((view.height * prescale) / SCRATCH_STEP_PX) * SCRATCH_STEP_PX
		);
		if (this.scratch.width !== width) this.scratch.width = width;
		if (this.scratch.height !== height) this.scratch.height = height;
	}
}
