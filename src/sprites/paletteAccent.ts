import {PALETTES} from "@/sprites/palettes";
import type {HexColor} from "@/types";

// fallback for null palette (offline / pre-selection) so chat names always
// render with a visible color rather than inheriting the panel foreground.
export const DEFAULT_ACCENT_COLOR: HexColor = "#3cd96b";

const ACCENT_BY_ID = new Map<string, HexColor>(PALETTES.map((p) => [p.id, p.accentColor]));

// DOM-free lookup importable by both client (for fallback rendering) and
// server (to stamp ChatMessage.color at send time). null/unknown -> default
// green so a player with no palette selected still has a stable name color.
export function paletteAccent(paletteId: string | null | undefined): HexColor {
	if (!paletteId) return DEFAULT_ACCENT_COLOR;
	return ACCENT_BY_ID.get(paletteId) ?? DEFAULT_ACCENT_COLOR;
}
