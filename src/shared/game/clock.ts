import {TICK_HZ} from "@/shared/protocol";

// the simulation ticks at the shared rate whether or not a server is involved:
// offline play and online prediction run the same physics, so they share the
// timing too.
export const DEFAULT_TICK_RATE_HZ = TICK_HZ;

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
	// fixed for the clock's lifetime: the rate is a contract shared with the
	// server (see TICK_HZ), so a clock that could be re-rated mid-session would
	// only be a way to break it.
	private readonly tickIntervalMs: number;
	private currentTick = 0;

	constructor(tickRateHz: number = DEFAULT_TICK_RATE_HZ) {
		this.tickIntervalMs = 1000 / tickRateHz;
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
