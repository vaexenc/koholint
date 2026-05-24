export type SpriteSheetData = {
	index: number;
	x: number;
	y: number;
	width: number;
	height: number;
	offsetX?: number;
	offsetY?: number;
}[];

export type HexColor = `#${string}`;

export type SpritePalette = Record<number, HexColor[]>;

export type AvatarData = {
	imageUrl: string;
	sheet: SpriteSheetData;
	palette?: SpritePalette;
};

export type SpriteSheetColorMap = Record<HexColor, HexColor>;
