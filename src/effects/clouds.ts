// drifting cloud shadows rendered into the offscreen map bitmap. each
// cloud is a small cluster of soft radial puffs; the whole field wraps
// modulo (mapSize + margin) so puffs re-enter on the opposite edge.

export type CloudField = {
	readonly clouds: readonly Cloud[];
	readonly mapWidth: number;
	readonly mapHeight: number;
};

type Cloud = {
	readonly baseX: number;
	readonly baseY: number;
	readonly puffs: readonly Puff[];
};

type Puff = {
	readonly ox: number;
	readonly oy: number;
	readonly radius: number;
};

const WIND_X = 14;
const WIND_Y = 5;
const SHADOW_RGB = "18, 26, 40";
const SHADOW_ALPHA = 0.06;
const SHADOW_CORE_STOP = 0.4;
const CLOUD_PIXELS_PER_UNIT = 22_000;
const MIN_CLOUDS = 16;
const MAX_CLOUDS = 120;
const PUFF_MIN = 4;
const PUFF_MAX = 8;
const PUFF_RADIUS_MIN = 36;
const PUFF_RADIUS_MAX = 96;
const PUFF_SPREAD_X = 130;
const PUFF_SPREAD_Y = 70;
const WRAP_MARGIN = 220;

function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function createCloudField(mapWidth: number, mapHeight: number, seed = 0x10ad1e): CloudField {
	const rng = mulberry32(seed);
	const target = Math.round((mapWidth * mapHeight) / CLOUD_PIXELS_PER_UNIT);
	const count = Math.max(MIN_CLOUDS, Math.min(MAX_CLOUDS, target));
	const clouds: Cloud[] = [];
	for (let i = 0; i < count; i++) {
		const puffCount = PUFF_MIN + Math.floor(rng() * (PUFF_MAX - PUFF_MIN + 1));
		const puffs: Puff[] = [];
		for (let j = 0; j < puffCount; j++) {
			puffs.push({
				ox: (rng() - 0.5) * PUFF_SPREAD_X,
				oy: (rng() - 0.5) * PUFF_SPREAD_Y,
				radius: PUFF_RADIUS_MIN + rng() * (PUFF_RADIUS_MAX - PUFF_RADIUS_MIN),
			});
		}
		clouds.push({
			baseX: rng() * (mapWidth + WRAP_MARGIN * 2),
			baseY: rng() * (mapHeight + WRAP_MARGIN * 2),
			puffs,
		});
	}
	return {clouds, mapWidth, mapHeight};
}

export function drawCloudShadows(
	ctx: CanvasRenderingContext2D,
	field: CloudField,
	timeMs: number
): void {
	const t = timeMs / 1000;
	const dx = WIND_X * t;
	const dy = WIND_Y * t;
	const wrapW = field.mapWidth + WRAP_MARGIN * 2;
	const wrapH = field.mapHeight + WRAP_MARGIN * 2;
	ctx.save();
	for (const cloud of field.clouds) {
		const cx = wrap(cloud.baseX + dx, wrapW) - WRAP_MARGIN;
		const cy = wrap(cloud.baseY + dy, wrapH) - WRAP_MARGIN;
		for (const puff of cloud.puffs) {
			const px = cx + puff.ox;
			const py = cy + puff.oy;
			const grad = ctx.createRadialGradient(px, py, 0, px, py, puff.radius);
			grad.addColorStop(0, `rgba(${SHADOW_RGB}, ${SHADOW_ALPHA})`);
			grad.addColorStop(SHADOW_CORE_STOP, `rgba(${SHADOW_RGB}, ${SHADOW_ALPHA})`);
			grad.addColorStop(1, `rgba(${SHADOW_RGB}, 0)`);
			ctx.fillStyle = grad;
			ctx.beginPath();
			ctx.arc(px, py, puff.radius, 0, Math.PI * 2);
			ctx.fill();
		}
	}
	ctx.restore();
}

function wrap(value: number, modulus: number): number {
	return ((value % modulus) + modulus) % modulus;
}
