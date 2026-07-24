import type {HexColor, SpritePalette} from "@/types";

export type NamedPalette = {
	id: string;
	name: string;
	palette: SpritePalette;
	// chat-name accent color for this palette. shared by client + server via
	// profileAccent.ts; mirrors the palette's primary hue but tuned for
	// readability on the chat panel's dark background.
	accentColor: HexColor;
};

// hue-wheel order (red → pink), neutrals last.
export const PALETTES: readonly NamedPalette[] = [
	{
		// primary matches the red in the din sprite exactly.
		id: "red",
		name: "Red",
		palette: {primary: ["#ff0829"], skin: ["#ffd68c"]},
		accentColor: "#ff6b6b",
	},
	{
		// primary matches the orange in the marin sprite exactly.
		id: "orange",
		name: "Orange",
		palette: {primary: ["#ff7b08"], skin: ["#ffd68c"]},
		accentColor: "#ff9d45",
	},
	{
		id: "yellow",
		name: "Yellow",
		palette: {primary: ["#e8c023"], skin: ["#ffd68c"]},
		accentColor: "#f5d24a",
	},
	{
		id: "brown",
		name: "Brown",
		palette: {primary: ["#8a5a28"], skin: ["#ffd68c"]},
		accentColor: "#c99a5e",
	},
	{
		id: "green",
		name: "Green",
		palette: {primary: ["#10ad42"], skin: ["#ffd68c"]},
		accentColor: "#3cd96b",
	},
	{
		id: "blue",
		name: "Blue",
		palette: {primary: ["#1984ff"], skin: ["#ffd68c"]},
		accentColor: "#4ea8ff",
	},
	{
		id: "purple",
		name: "Purple",
		palette: {primary: ["#8a3ad7"], skin: ["#ffd68c"]},
		accentColor: "#b380ff",
	},
	{
		id: "pink",
		name: "Pink",
		palette: {primary: ["#e84fa4"], skin: ["#ffd68c"]},
		accentColor: "#ff7fc4",
	},
	{
		id: "black",
		name: "Black",
		palette: {primary: ["#303030"], skin: ["#ffd68c"]},
		accentColor: "#a3a3a3",
	},
	{
		id: "mono",
		name: "Mono",
		palette: {primary: ["#5a5a5a"], skin: ["#c8c8c8"]},
		accentColor: "#c8c8c8",
	},
];

const PALETTE_ID_SET: ReadonlySet<string> = new Set(PALETTES.map((p) => p.id));

export function isKnownPaletteId(id: string): boolean {
	return PALETTE_ID_SET.has(id);
}

export function resolvePaletteSwap(paletteId: string | null): SpritePalette | undefined {
	if (!paletteId) return undefined;
	return PALETTES.find((p) => p.id === paletteId)?.palette;
}
