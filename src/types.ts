export type SpriteSheetFrame = {
	index: number;
	x: number;
	y: number;
	width: number;
	height: number;
	offsetX?: number;
	offsetY?: number;
};

export type SpriteSheet = SpriteSheetFrame[];

export type HexColor = `#${string}`;

export type SpritePalette = Record<number, HexColor[]>;

export type SpriteAsset = {
	imageUrl: string;
	sheet: SpriteSheet;
	palette?: SpritePalette;
};

export type SpriteSheetColorMap = Record<HexColor, HexColor>;
