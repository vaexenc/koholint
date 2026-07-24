// screen-space chat bubbles stacked above a character's head. drawn on the
// main canvas (CSS pixels, like the movement hint) so text stays crisp at any
// camera zoom. styling mirrors the bottom HUD widgets: translucent black
// rounded rect, light text, no tail.

import {ensureZeldaFontLoaded, ZELDA_FONT_STACK, ZELDA_LETTER_SPACING} from "@/game/zeldaFont";

const LIFETIME_MS = 10000;
const FADE_MS = 300;
const MAX_STACK = 3;
const MAX_LINES = 8;
// bubble tops out at ~350px CSS with padding included.
const MAX_TEXT_WIDTH = 325;
const TEXT_SIZE = 20;
// paddings scale with the text; top is tighter than bottom so the stack sits
// a touch higher over the text than below it.
const PADDING_X = TEXT_SIZE * 0.6;
const PADDING_TOP = TEXT_SIZE * 0.4;
const PADDING_BOTTOM = TEXT_SIZE * 0.6;
// matches the button/widget rounded-lg radius.
const CORNER_RADIUS = 10;
const LINE_HEIGHT = TEXT_SIZE * 1.1;
const STACK_GAP = 4;
const HEAD_GAP = 3;
const FONT = `${TEXT_SIZE}px ${ZELDA_FONT_STACK}`;
const FILL = "rgba(0,0,0,0.7)";
const TEXT_COLOR = "rgba(255,255,255,0.95)";

export type ChatBubble = {
	readonly text: string;
	readonly expiresAt: number;
	// wrapped lazily on first draw (wrapping needs a measuring context).
	lines: readonly string[] | null;
};

// newest message sits nearest the head; the oldest is evicted once the stack
// is full. bubbles share a fixed lifetime, so expiry order equals push order.
export function pushChatBubble(bubbles: ChatBubble[], text: string, now: number): void {
	bubbles.push({text, expiresAt: now + LIFETIME_MS, lines: null});
	if (bubbles.length > MAX_STACK) bubbles.shift();
}

export function pruneChatBubbles(bubbles: ChatBubble[], now: number): void {
	while (bubbles.length > 0 && bubbles[0].expiresAt <= now) bubbles.shift();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string): string[] {
	const words = text.split(/\s+/).filter(Boolean);
	const lines: string[] = [];
	let line = "";
	for (const word of words) {
		const candidate = line ? `${line} ${word}` : word;
		if (ctx.measureText(candidate).width <= MAX_TEXT_WIDTH) {
			line = candidate;
			continue;
		}
		if (line) lines.push(line);
		// a single word wider than the bubble breaks by character.
		let rest = word;
		while (ctx.measureText(rest).width > MAX_TEXT_WIDTH) {
			let take = rest.length;
			while (take > 1 && ctx.measureText(rest.slice(0, take)).width > MAX_TEXT_WIDTH) take--;
			lines.push(rest.slice(0, take));
			rest = rest.slice(take);
		}
		line = rest;
	}
	if (line) lines.push(line);
	if (lines.length <= MAX_LINES) return lines;
	const kept = lines.slice(0, MAX_LINES);
	let last = kept[MAX_LINES - 1];
	while (last.length > 0 && ctx.measureText(`${last}…`).width > MAX_TEXT_WIDTH) {
		last = last.slice(0, -1);
	}
	kept[MAX_LINES - 1] = `${last}…`;
	return kept;
}

// draws the stack in screen-space (CSS pixels), centered on `centerX`, growing
// upward from `headTopY` (the screen-y of the sprite's top). caller prunes
// expired bubbles before calling.
export function drawChatBubbles(
	ctx: CanvasRenderingContext2D,
	bubbles: readonly ChatBubble[],
	centerX: number,
	headTopY: number,
	now: number,
	scale: number
): void {
	ensureZeldaFontLoaded();
	ctx.save();
	// scale around the head anchor; text is wrapped and measured at the base
	// size, so the cached lines stay valid at every zoom level.
	ctx.translate(centerX, headTopY);
	ctx.scale(scale, scale);
	ctx.font = FONT;
	// set before wrapText measures, so wrapping accounts for the tighter spacing.
	ctx.letterSpacing = ZELDA_LETTER_SPACING;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	let bottom = -HEAD_GAP;
	for (let i = bubbles.length - 1; i >= 0; i--) {
		const bubble = bubbles[i];
		bubble.lines ??= wrapText(ctx, bubble.text);
		if (bubble.lines.length === 0) continue;
		const textWidth = Math.max(...bubble.lines.map((l) => ctx.measureText(l).width));
		const width = textWidth + PADDING_X * 2;
		const height = bubble.lines.length * LINE_HEIGHT + PADDING_TOP + PADDING_BOTTOM;
		const top = bottom - height;
		ctx.globalAlpha = Math.min(1, (bubble.expiresAt - now) / FADE_MS);
		ctx.beginPath();
		ctx.roundRect(-width / 2, top, width, height, CORNER_RADIUS);
		ctx.fillStyle = FILL;
		ctx.fill();
		ctx.fillStyle = TEXT_COLOR;
		for (let li = 0; li < bubble.lines.length; li++) {
			const lineY = top + PADDING_TOP + li * LINE_HEIGHT + LINE_HEIGHT / 2;
			ctx.fillText(bubble.lines[li], 0, lineY);
		}
		bottom = top - STACK_GAP;
	}
	ctx.restore();
}
