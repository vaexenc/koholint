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

export type SpriteAnimationFrame = {
	spriteIndex: number;
	mirrorX?: boolean;
	mirrorY?: boolean;
};

export type SpriteAnimation = {
	frames: SpriteAnimationFrame[];
	frameDurationMs: number;
};

// the 4-direction stand + walk vocabulary every character animates with.
export type CharacterAnimationName =
	| "stand_down"
	| "stand_up"
	| "stand_left"
	| "stand_right"
	| "walk_down"
	| "walk_up"
	| "walk_left"
	| "walk_right";

export type CharacterAnimationSet = Record<CharacterAnimationName, SpriteAnimation>;

export type SpriteAsset = {
	imageUrl: string;
	sheet: SpriteSheet;
	palette?: SpritePalette;
	// overrides the classic 4-frame animation set for sheets with a different
	// layout (e.g. bowwow's 5 frames, ghini's 2).
	animations?: CharacterAnimationSet;
};

export type SpriteSheetColorMap = Map<HexColor, HexColor>;
