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

export type SpritePalette = {
	primary?: HexColor[];
	skin?: HexColor[];
};

export type SpriteAsset = {
	imageUrl: string;
	sheet: SpriteSheet;
	palette?: SpritePalette;
};

export type SpriteSheetColorMap = Map<HexColor, HexColor>;
