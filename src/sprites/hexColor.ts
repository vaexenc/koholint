import type {HexColor} from "@/types";

export type Rgb = readonly [number, number, number];

export function hexToRgb(hex: HexColor): Rgb {
	const v = hex.slice(1);
	return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

// squared distance in rgb space. comparing candidates never needs the sqrt, so
// callers rank on this directly.
export function colorDistanceSq(a: Rgb, b: Rgb): number {
	return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}
