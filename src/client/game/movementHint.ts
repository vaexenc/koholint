// screen-space "you can move" hint that sits under the player's feet and
// crossfades between the WASD and arrow-key clusters until the player has
// pressed a full set. drawn on the main canvas (not the pixel-art offscreen)
// so the keys stay crisp at any camera zoom.

type KeySet = {
	// order: [top, bottom-left, bottom-mid, bottom-right] — matches the physical
	// inverted-T layout both schemes share.
	readonly keys: readonly [string, string, string, string];
	readonly glyphs: readonly [string, string, string, string];
};

const WASD: KeySet = {keys: ["w", "a", "s", "d"], glyphs: ["W", "A", "S", "D"]};
const ARROWS: KeySet = {
	keys: ["arrowup", "arrowleft", "arrowdown", "arrowright"],
	glyphs: ["↑", "←", "↓", "→"],
};

// the player has "learned" movement once they've exercised a full directional
// set. either scheme counts; pressing all of one dismisses the hint for good.
export function isMovementLearned(seen: ReadonlySet<string>): boolean {
	return WASD.keys.every((k) => seen.has(k)) || ARROWS.keys.every((k) => seen.has(k));
}

// CSS-pixel sizes — drawn on the main canvas so they don't share the map's
// nearest-neighbor pixel scaling.
const KEY_SIZE = 26;
const KEY_GAP = 4;
const FOOT_GAP = 14;
const CYCLE_MS = 2800;
const BASE_ALPHA = 0.95;

function keyOffsets(): readonly [number, number][] {
	const step = KEY_SIZE + KEY_GAP;
	// centered on x=0; top key over the middle of the bottom row.
	return [
		[-KEY_SIZE / 2, 0],
		[-step - KEY_SIZE / 2, step],
		[-KEY_SIZE / 2, step],
		[step - KEY_SIZE / 2, step],
	];
}

const INK = "rgba(255,255,255,0.95)";
const PILL_FILL = "rgba(0,0,0,0.6)";
const PRESSED_INK = "#111827";

// the hint's one piece of chrome: a rounded, outlined pill with a label centered
// in it. a key cap is the square case, the touch hint the wide one — and a
// pressed key just swaps ink for fill.
function drawPill(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	width: number,
	radius: number,
	label: string,
	inverted: boolean
): void {
	ctx.beginPath();
	ctx.roundRect(x, y, width, KEY_SIZE, radius);
	ctx.fillStyle = inverted ? INK : PILL_FILL;
	ctx.fill();
	ctx.lineWidth = 1.5;
	ctx.strokeStyle = INK;
	ctx.stroke();
	ctx.fillStyle = inverted ? PRESSED_INK : INK;
	ctx.fillText(label, x + width / 2, y + KEY_SIZE / 2 + 1);
}

// pulse/crossfade phase, 0→1→0 over one CYCLE_MS. both hints breathe on it.
function cyclePhase(timeMs: number): number {
	return 0.5 * (1 - Math.cos((2 * Math.PI * (timeMs % CYCLE_MS)) / CYCLE_MS));
}

function drawSet(
	ctx: CanvasRenderingContext2D,
	set: KeySet,
	centerX: number,
	topY: number,
	seen: ReadonlySet<string>,
	alpha: number
): void {
	if (alpha <= 0) return;
	ctx.globalAlpha = alpha;
	const offsets = keyOffsets();
	for (let i = 0; i < 4; i++) {
		const [dx, dy] = offsets[i];
		drawPill(ctx, centerX + dx, topY + dy, KEY_SIZE, 5, set.glyphs[i], seen.has(set.keys[i]));
	}
}

// touch counterpart of the key hint: a "Hold to walk" pill under the player's
// feet, gently pulsing until the first successful hold-steer dismisses it.
export function drawTouchMovementHint(
	ctx: CanvasRenderingContext2D,
	centerX: number,
	footY: number,
	timeMs: number
): void {
	const topY = footY + FOOT_GAP;
	const label = "Hold to walk";
	ctx.save();
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.font = "bold 15px system-ui, -apple-system, sans-serif";
	const width = ctx.measureText(label).width + 24;
	ctx.globalAlpha = BASE_ALPHA * (0.7 + 0.3 * cyclePhase(timeMs));
	drawPill(ctx, centerX - width / 2, topY, width, 8, label, false);
	ctx.restore();
}

// draws the hint in screen-space (CSS pixels), centered on `centerX`, just
// below `footY` (the screen-y of the sprite's feet). caller gates on
// isMovementLearned() before calling.
export function drawMovementHint(
	ctx: CanvasRenderingContext2D,
	centerX: number,
	footY: number,
	seen: ReadonlySet<string>,
	timeMs: number
): void {
	// cosine crossfade: both alphas always sum to 1 so the hint never blanks
	// out between phases. starts on WASD (alphaWasd=1) at timeMs=0.
	const phase = cyclePhase(timeMs);
	const alphaWasd = BASE_ALPHA * (1 - phase);
	const alphaArrows = BASE_ALPHA * phase;

	const topY = footY + FOOT_GAP;
	ctx.save();
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.font = "bold 18px system-ui, -apple-system, sans-serif";
	drawSet(ctx, WASD, centerX, topY, seen, alphaWasd);
	drawSet(ctx, ARROWS, centerX, topY, seen, alphaArrows);
	ctx.restore();
}
