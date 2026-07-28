import {GameClock} from "@/shared/game";
import {INPUT_LEAD_TICKS, MAX_INPUT_LEAD_TICKS} from "@/shared/protocol";

// maps our local fixed-step clock onto the server's tick numbering. both run at
// the same rate but start at different values and drift, so we carry the
// difference as an offset, biased by INPUT_LEAD_TICKS so the inputs we stamp
// land in the server's near future instead of its past. owns the one invariant
// the prediction path leans on: currentServerTick() is the server tick our
// latest locally-simulated tick maps to.
export class ServerClock {
	private offset = 0;
	private readonly clock: GameClock;

	constructor(clock: GameClock) {
		this.clock = clock;
	}

	advance(dtMs: number, step: (localTick: number, dtSec: number) => void): number {
		return this.clock.advance(dtMs, step);
	}

	getInterpolationAlpha(): number {
		return this.clock.getInterpolationAlpha();
	}

	// the server tick a given local tick maps to.
	serverTickFor(localTick: number): number {
		return localTick + this.offset;
	}

	// the server tick our latest locally-simulated tick maps to.
	currentServerTick(): number {
		return this.clock.getCurrentTick() + this.offset;
	}

	// hard re-anchor on welcome: a fresh hello (or a server that restarted its
	// tick counter) resets the offset outright, even downward.
	resetToServerTick(serverTick: number): void {
		this.offset = this.offsetFor(serverTick);
	}

	// per-snapshot re-anchor: ratchet up so a local dropped-tick stall
	// (clock.advance bailing after a tab freeze) can't let the estimate fall
	// behind the server — inputs would land in its past and stop being applied.
	syncToServerTick(serverTick: number): void {
		const wanted = this.offsetFor(serverTick);
		if (wanted > this.offset) this.offset = wanted;
		// ...but not up only: the server's tick counter permanently falls
		// behind wall time whenever its catch-up loop drops backlog under load,
		// and an offset locked to the pre-stall maximum then stamps every input
		// past the server's acceptance window — acks freeze for the rest of the
		// session and each snapshot replays the whole frozen span. cap the lead
		// against the live measurement so the estimate deflates once the server
		// is genuinely behind it. a stale localTick inflates wanted and this
		// ceiling equally, so jank can't clamp a correct offset by mistake.
		const ceiling = wanted - INPUT_LEAD_TICKS + MAX_INPUT_LEAD_TICKS;
		if (this.offset > ceiling) this.offset = ceiling;
	}

	private offsetFor(serverTick: number): number {
		return serverTick - this.clock.getCurrentTick() + INPUT_LEAD_TICKS;
	}
}
