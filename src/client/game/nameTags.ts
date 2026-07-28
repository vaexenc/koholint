// screen-space name tag above a character's head. drawn on the main canvas
// (CSS pixels, like chat bubbles) so text stays crisp at any camera zoom.
// no background pill — a dark outline keeps the accent-colored text readable
// over any terrain.

import {beginOverlayText} from "./zeldaFont";

const TEXT_SIZE = 18;
// gap between the sprite's head and the name; scales with the text so the
// whole tag (and the chat bubble offset above it) grows together.
const HEAD_GAP = TEXT_SIZE * 0.5;
const OUTLINE_COLOR = "rgba(0,0,0,0.9)";
const OUTLINE_WIDTH = TEXT_SIZE * 0.375;

// vertical space a tag occupies above the head at scale 1; chat bubbles raise
// their anchor by this (times the same scale) so they stack above the name
// instead of covering it.
export const NAME_TAG_HEIGHT = HEAD_GAP + TEXT_SIZE;

export function drawNameTag(
	ctx: CanvasRenderingContext2D,
	name: string,
	color: string,
	centerX: number,
	headTopY: number,
	scale: number
): void {
	// scale around the head anchor so text, gap and outline grow together.
	beginOverlayText(ctx, TEXT_SIZE, centerX, headTopY, scale);
	// round joins stop the miter spikes sharp glyph corners would produce.
	ctx.lineJoin = "round";
	ctx.lineWidth = OUTLINE_WIDTH;
	ctx.strokeStyle = OUTLINE_COLOR;
	const y = -HEAD_GAP - TEXT_SIZE / 2;
	ctx.strokeText(name, 0, y);
	// palette accents are tuned for chat text on the dark panel; against the
	// black outline the darker ones lose contrast, so lift them toward white.
	ctx.fillStyle = `color-mix(in oklab, ${color} 50%, white)`;
	ctx.fillText(name, 0, y);
	ctx.restore();
}
