import type {SpritePalette} from "@/types";

export type NamedPalette = {
	id: string;
	name: string;
	palette: SpritePalette;
};

export const PALETTES: readonly NamedPalette[] = [
	{
		id: "green",
		name: "Green",
		palette: {
			primary: ["#10ad42"],
			skin: ["#ffd68c"],
		},
	},
	{
		id: "blue",
		name: "Blue",
		palette: {
			primary: ["#1984ff"],
			skin: ["#ffd68c"],
		},
	},
	{
		id: "red",
		name: "Red",
		palette: {
			primary: ["#d73a3a"],
			skin: ["#ffd68c"],
		},
	},
	{
		id: "purple",
		name: "Purple",
		palette: {
			primary: ["#8a3ad7"],
			skin: ["#ffd68c"],
		},
	},
	{
		id: "yellow",
		name: "Yellow",
		palette: {
			primary: ["#e8c023"],
			skin: ["#ffd68c"],
		},
	},
	{
		id: "cyan",
		name: "Cyan",
		palette: {
			primary: ["#23c4d8"],
			skin: ["#ffd68c"],
		},
	},
	{
		id: "umber",
		name: "Umber",
		palette: {
			primary: ["#10ad42"],
			skin: ["#b97c4a"],
		},
	},
	{
		id: "mono",
		name: "Mono",
		palette: {
			primary: ["#5a5a5a"],
			skin: ["#c8c8c8"],
		},
	},
];
