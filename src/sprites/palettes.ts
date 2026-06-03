import type {HexColor, SpritePalette} from "@/types";

export type NamedPalette = {
	id: string;
	name: string;
	palette: SpritePalette;
	// chat-name accent color for this palette. shared by client + server via
	// paletteAccent.ts; mirrors the palette's primary hue but tuned for
	// readability on the chat panel's dark background.
	accentColor: HexColor;
};

export const PALETTES: readonly NamedPalette[] = [
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
		id: "red",
		name: "Red",
		palette: {primary: ["#d73a3a"], skin: ["#ffd68c"]},
		accentColor: "#ff6b6b",
	},
	{
		id: "purple",
		name: "Purple",
		palette: {primary: ["#8a3ad7"], skin: ["#ffd68c"]},
		accentColor: "#b380ff",
	},
	{
		id: "yellow",
		name: "Yellow",
		palette: {primary: ["#e8c023"], skin: ["#ffd68c"]},
		accentColor: "#f5d24a",
	},
	{
		id: "cyan",
		name: "Cyan",
		palette: {primary: ["#23c4d8"], skin: ["#ffd68c"]},
		accentColor: "#5ee0ef",
	},
	{
		id: "umber",
		name: "Umber",
		palette: {primary: ["#10ad42"], skin: ["#b97c4a"]},
		accentColor: "#d49a6a",
	},
	{
		id: "mono",
		name: "Mono",
		palette: {primary: ["#5a5a5a"], skin: ["#c8c8c8"]},
		accentColor: "#c8c8c8",
	},
];
