const FLIP_HORIZONTAL_FLAG = 0x80000000;
const FLIP_VERTICAL_FLAG = 0x40000000;
const FLIP_DIAGONAL_FLAG = 0x20000000;
const TILE_ID_MASK = 0x0fffffff;

export const EMPTY_TILE_ID = 0;

export type TileFlip = {
	readonly horizontal: boolean;
	readonly vertical: boolean;
	readonly diagonal: boolean;
};

export type DecodedTile = {
	readonly id: number;
	readonly flip: TileFlip;
};

export function decodeTileGid(gid: number): DecodedTile {
	return {
		id: gid & TILE_ID_MASK,
		flip: {
			horizontal: (gid & FLIP_HORIZONTAL_FLAG) !== 0,
			vertical: (gid & FLIP_VERTICAL_FLAG) !== 0,
			diagonal: (gid & FLIP_DIAGONAL_FLAG) !== 0,
		},
	};
}

export function isFlipped(flip: TileFlip): boolean {
	return flip.horizontal || flip.vertical || flip.diagonal;
}
