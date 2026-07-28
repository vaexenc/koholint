import type {Profile} from "@/shared/protocol";
import {AVATARS} from "@/shared/sprites/avatars";
import {colorDistanceSq, hexToRgb} from "@/shared/sprites/hexColor";
import {PALETTES} from "@/shared/sprites/palettes";
import type {HexColor} from "@/shared/sprites/types";

// floor for a sprite that declares no palette of its own. every avatar ships
// one today, so this only keeps the lookups total.
const FALLBACK_ACCENT_COLOR: HexColor = "#e5e5e5";

const ACCENT_BY_PALETTE_ID = new Map<string, HexColor>(PALETTES.map((p) => [p.id, p.accentColor]));

// accent of the palette whose primary sits closest to `color`. sprite primaries
// are the same hexes the palettes swap to, so this is an exact hit for every
// avatar but impa (whose red is a shade darker) — nearest match spares us a
// per-avatar table while still landing on the readability-tuned accent.
function nearestPaletteAccent(color: HexColor): HexColor {
	const rgb = hexToRgb(color);
	let accent = FALLBACK_ACCENT_COLOR;
	let nearest = Infinity;
	for (const {palette, accentColor} of PALETTES) {
		const primary = palette.primary?.[0];
		if (!primary) continue;
		const distance = colorDistanceSq(rgb, hexToRgb(primary));
		if (distance >= nearest) continue;
		nearest = distance;
		accent = accentColor;
	}
	return accent;
}

const NATIVE_ACCENT_BY_AVATAR_ID = new Map<string, HexColor>(
	AVATARS.map((avatar) => {
		const primary = avatar.sprite.palette?.primary?.[0];
		return [avatar.id, primary ? nearestPaletteAccent(primary) : FALLBACK_ACCENT_COLOR];
	})
);

// DOM-free lookup importable by both client (nametags, player list) and server
// (to stamp ChatMessage.color at send time). with no palette selected the
// sprite keeps its own colors, so the name follows them rather than posing as a
// palette the player never picked. an unknown palette id resolves the same way
// resolvePaletteSwap treats it: no swap, so native colors.
export function profileAccent({
	avatarId,
	paletteId,
}: Pick<Profile, "avatarId" | "paletteId">): HexColor {
	const selected = paletteId ? ACCENT_BY_PALETTE_ID.get(paletteId) : undefined;
	return selected ?? NATIVE_ACCENT_BY_AVATAR_ID.get(avatarId) ?? FALLBACK_ACCENT_COLOR;
}
