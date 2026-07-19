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

function drawKey(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	glyph: string,
	pressed: boolean
): void {
	ctx.beginPath();
	ctx.roundRect(x, y, KEY_SIZE, KEY_SIZE, 5);
	ctx.fillStyle = pressed ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.6)";
	ctx.fill();
	ctx.lineWidth = 1.5;
	ctx.strokeStyle = "rgba(255,255,255,0.95)";
	ctx.stroke();
	ctx.fillStyle = pressed ? "#111827" : "rgba(255,255,255,0.95)";
	ctx.fillText(glyph, x + KEY_SIZE / 2, y + KEY_SIZE / 2 + 1);
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
		drawKey(ctx, centerX + dx, topY + dy, set.glyphs[i], seen.has(set.keys[i]));
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
	const t = (timeMs % CYCLE_MS) / CYCLE_MS;
	const phase = 0.5 * (1 - Math.cos(2 * Math.PI * t));
	const alpha = BASE_ALPHA * (0.7 + 0.3 * phase);
	const topY = footY + FOOT_GAP;
	const label = "Hold to walk";
	ctx.save();
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.font = "bold 15px system-ui, -apple-system, sans-serif";
	const width = ctx.measureText(label).width + 24;
	ctx.globalAlpha = alpha;
	ctx.beginPath();
	ctx.roundRect(centerX - width / 2, topY, width, KEY_SIZE, 8);
	ctx.fillStyle = "rgba(0,0,0,0.6)";
	ctx.fill();
	ctx.lineWidth = 1.5;
	ctx.strokeStyle = "rgba(255,255,255,0.95)";
	ctx.stroke();
	ctx.fillStyle = "rgba(255,255,255,0.95)";
	ctx.fillText(label, centerX, topY + KEY_SIZE / 2 + 1);
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
	const t = (timeMs % CYCLE_MS) / CYCLE_MS;
	const phase = 0.5 * (1 - Math.cos(2 * Math.PI * t));
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
