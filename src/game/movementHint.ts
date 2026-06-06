// canvas-drawn "you can move" hint that sits under the player and cross-fades
// between the WASD and arrow-key clusters until the player has pressed a full
// set. world-space (drawn into the same offscreen the map renders to), so it
// rides the camera for free and shares the pixel aesthetic.

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

const KEY_SIZE = 7;
const KEY_GAP = 1;
const FOOT_GAP = 4;
const CYCLE_MS = 2600;
const FADE_MS = 450;
const BASE_ALPHA = 0.92;

// 0 at each half-boundary, 1 in the middle — so the visible set fully fades out
// before the other fades in, and they never overlap mid-swap.
function halfEnvelope(posInHalf: number, halfMs: number): number {
	if (posInHalf < FADE_MS) return posInHalf / FADE_MS;
	if (posInHalf > halfMs - FADE_MS) return (halfMs - posInHalf) / FADE_MS;
	return 1;
}

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
	ctx.roundRect(x, y, KEY_SIZE, KEY_SIZE, 1.5);
	ctx.fillStyle = pressed ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.55)";
	ctx.fill();
	ctx.lineWidth = 0.5;
	ctx.strokeStyle = "rgba(255,255,255,0.9)";
	ctx.stroke();
	ctx.fillStyle = pressed ? "#111827" : "rgba(255,255,255,0.9)";
	ctx.fillText(glyph, x + KEY_SIZE / 2, y + KEY_SIZE / 2 + 0.5);
}

// draws the hint centered horizontally on `centerX`, just below `footY` (the
// bottom of the sprite). caller gates on isMovementLearned() before calling.
export function drawMovementHint(
	ctx: CanvasRenderingContext2D,
	centerX: number,
	footY: number,
	seen: ReadonlySet<string>,
	timeMs: number
): void {
	const halfMs = CYCLE_MS / 2;
	const local = timeMs % CYCLE_MS;
	const showArrows = local >= halfMs;
	const set = showArrows ? ARROWS : WASD;
	const opacity = BASE_ALPHA * halfEnvelope(showArrows ? local - halfMs : local, halfMs);
	if (opacity <= 0) return;

	const topY = footY + FOOT_GAP;
	const offsets = keyOffsets();
	ctx.save();
	ctx.globalAlpha = opacity;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.font = "5px monospace";
	for (let i = 0; i < 4; i++) {
		const [dx, dy] = offsets[i];
		drawKey(ctx, centerX + dx, topY + dy, set.glyphs[i], seen.has(set.keys[i]));
	}
	ctx.restore();
}
