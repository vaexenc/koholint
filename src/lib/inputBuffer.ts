import type {CharacterInput} from "@/game/types";
import type {CoalescedInput} from "@/protocol";

// drop inputs older than ~30s so a long disconnect doesn't shower the server
// with stale frames on resume. matches MAX_INPUT_AGE_TICKS on the server.
const INPUT_MAX_AGE_TICKS = 30 * 30;

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
