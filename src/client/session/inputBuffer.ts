import type {CharacterInput} from "@/shared/game/types";
import type {CoalescedInput} from "@/shared/protocol";

// drop inputs older than ~30s (at the 30Hz tick rate) so a stalled ack can't
// grow the buffer without bound. exported as the replay-window bound: any tick
// this far behind the newest recorded one is guaranteed pruned, so replaying
// it can only yield NEUTRAL.
export const INPUT_MAX_AGE_TICKS = 30 * 30;

// per-tab record of locally sampled inputs, keyed by server tick. shared by
// the leader's wire client and the follower mirror so prediction replay and
// the redundant-flush protocol read from one implementation.
export class InputBuffer {
	private readonly byTick = new Map<number, CharacterInput>();

	record(tick: number, input: CharacterInput): void {
		this.byTick.set(tick, input);
		const floor = tick - INPUT_MAX_AGE_TICKS;
		for (const t of this.byTick.keys()) if (t < floor) this.byTick.delete(t);
	}

	pruneUpTo(ackTick: number): void {
		for (const t of this.byTick.keys()) if (t <= ackTick) this.byTick.delete(t);
	}

	// every recorded input newer than the server's last ack and not past the
	// current local tick, ascending. redundancy (each batch carries all unacked
	// inputs) replaces retransmit logic.
	collectUnacked(ackTick: number, upToTick: number): CoalescedInput[] {
		const inputs: CoalescedInput[] = [];
		for (const [tick, input] of this.byTick) {
			if (tick > ackTick && tick <= upToTick) inputs.push({tick, input});
		}
		inputs.sort((a, b) => a.tick - b.tick);
		return inputs;
	}

	clear(): void {
		this.byTick.clear();
	}

	entries(): ReadonlyMap<number, CharacterInput> {
		return this.byTick;
	}
}
