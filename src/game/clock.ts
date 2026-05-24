export const DEFAULT_TICK_RATE_HZ = 30;

// hard cap on ticks integrated per advance() call. bails out of a spiral of
// death after a long tab freeze by dropping the leftover accumulator.
const MAX_TICKS_PER_ADVANCE = 8;

export type TickStep = (tick: number, dtSec: number) => void;

// fixed-step accumulator. callers pump wall-clock dt into advance() each
// frame; the clock fires `step` exactly N times where N is how many full tick
// intervals have elapsed since the last call. simulation is decoupled from
// the render loop so movement is reproducible across machines and frame
// rates, which is the precondition for server-authoritative replay later on.
export class GameClock {
	private accumulatorMs = 0;
	private tickIntervalMs: number;
	private tickRateHz: number;
	private currentTick = 0;

	constructor(tickRateHz: number = DEFAULT_TICK_RATE_HZ) {
		this.tickRateHz = tickRateHz;
		this.tickIntervalMs = 1000 / tickRateHz;
	}

	getTickRate(): number {
		return this.tickRateHz;
	}

	getTickIntervalMs(): number {
		return this.tickIntervalMs;
	}

	getCurrentTick(): number {
		return this.currentTick;
	}

	// fraction of the way to the next tick, in [0, 1). renderers use this to
	// interpolate between the last and current tick states so motion stays
	// smooth at low tick rates where individual steps are visibly far apart.
	getInterpolationAlpha(): number {
		const alpha = this.accumulatorMs / this.tickIntervalMs;
		return alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
	}

	setTickRate(tickRateHz: number): void {
		if (tickRateHz <= 0) throw new Error(`tick rate must be > 0, got ${tickRateHz}`);
		this.tickRateHz = tickRateHz;
		this.tickIntervalMs = 1000 / tickRateHz;
		// drop residual accumulator: the previous interval no longer applies
		// and we don't want a burst of catch-up ticks at the new rate.
		this.accumulatorMs = 0;
	}

	advance(dtMs: number, step: TickStep): number {
		this.accumulatorMs += dtMs;
		const dtSec = this.tickIntervalMs / 1000;
		let steps = 0;
		while (this.accumulatorMs >= this.tickIntervalMs && steps < MAX_TICKS_PER_ADVANCE) {
			step(this.currentTick, dtSec);
			this.currentTick++;
			this.accumulatorMs -= this.tickIntervalMs;
			steps++;
		}
		if (steps === MAX_TICKS_PER_ADVANCE) this.accumulatorMs = 0;
		return steps;
	}
}
