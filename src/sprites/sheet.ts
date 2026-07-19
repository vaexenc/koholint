import type {SpriteSheet} from "@/types";

// logical tile footprint of a sheet: the base frame's extent below the
// anchor once a negative offsetY pulls taller-than-tile art out of the box.
export function sheetFootprint(sheet: SpriteSheet): {width: number; height: number} {
	const base = sheet[0];
	if (!base) return {width: 16, height: 16};
	return {width: base.width, height: base.height + (base.offsetY ?? 0)};
}

// single-row sheet with 1px gutters between frames. frames taller than the
// 16px tile draw the extra rows above the anchor (negative offsetY) so the
// logical footprint stays the 16x16 tile box.
export function rowSheet(count: number, width = 16, height = 16): SpriteSheet {
	return Array.from({length: count}, (_, index) => ({
		index,
		x: index * (width + 1),
		y: 0,
		width,
		height,
		...(height > 16 ? {offsetY: 16 - height} : {}),
	}));
}
