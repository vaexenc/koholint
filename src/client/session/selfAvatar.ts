import {perfSample} from "@/client/lib/perfHud";
import {applyAppearance} from "@/client/session/appearance";
import type {GameHostContext} from "@/client/session/gameHost";
import {INPUT_MAX_AGE_TICKS} from "@/client/session/inputBuffer";
import type {PlayerPose} from "@/client/session/playerPose";
import {
	applyRemoteInterp,
	recordRemotePose,
	sampleFromCharacter,
	type PoseMirror,
} from "@/client/session/remoteInterp";
import {cancelAirborne, placeCharacter, type BasicCharacter, type World} from "@/shared/game";
import type {InputProvider} from "@/shared/game/controllers";
import {NEUTRAL_INPUT, type CharacterInput} from "@/shared/game/types";
import {TICK_HZ, type Profile} from "@/shared/protocol";
import {decodeAnimByteMs, type SnapshotPose} from "@/shared/protocol/snapshot";

// the local player's body, and the one question that sets it apart from every
// other character in the world: is this tab *driving* it, or watching it?
//
// the controlling tab predicts — it snaps the character onto each authoritative
// pose and replays its un-acked inputs on top. every other tab of the same
// identity is a spectator of its own avatar, so it buffers those poses and
// interpolates them exactly like a remote's. this owns both paths, the handoff
// between them, and the spawn that has to wait for the welcome. OnlineGame is
// then left with what it says it is: message routing, the roster, and the clock.

// the fixed step the server simulates at, which prediction replay re-steps in.
const TICK_DT_SEC = 1 / TICK_HZ;

export type SelfAvatarDeps = {
	readonly world: World;
	readonly renderer: GameHostContext["renderer"];
	readonly profile: () => Profile;
	// what this tab has told the server. the net layer's buffer stays the single
	// source of truth for that, so replay reads it rather than keeping a copy.
	readonly recordedInputs: () => ReadonlyMap<number, CharacterInput>;
	// the input channel the character binds to when it enters the world.
	readonly inputs: InputProvider;
};

export class SelfAvatar {
	readonly character: BasicCharacter;
	private readonly deps: SelfAvatarDeps;
	// while another tab controls the avatar this tab renders the self character
	// exactly like a remote: interpolated snapshots buffered here, no prediction.
	private readonly mirror: PoseMirror;
	private controlling = true;
	private spawned = false;
	// the wire id the server addresses this avatar's poses by; null until a
	// welcome or a join names it.
	private idIndex: number | null = null;
	// the welcome's spawn, held until the next step: entering the world is the
	// frame loop's business, not a message handler's.
	private pendingSpawn: PlayerPose | null = null;

	constructor(character: BasicCharacter, deps: SelfAvatarDeps) {
		this.character = character;
		this.deps = deps;
		this.mirror = {character, samples: []};
	}

	// whether a snapshot pose is ours. an unnamed avatar owns nothing, so a
	// pre-welcome snapshot can't be mistaken for one.
	owns(idIndex: number): boolean {
		return this.idIndex !== null && idIndex === this.idIndex;
	}

	setIdIndex(idIndex: number | null): void {
		this.idIndex = idIndex;
	}

	// the welcome's spawn. applied on the next step (see applyPendingSpawn), and
	// it resets the interp timeline too — fresh snapshots reseed it.
	placeOnNextStep(pose: PlayerPose): void {
		this.pendingSpawn = pose;
	}

	// the camera's target, and the character overlays hang off: null until the
	// welcome has actually placed it into the world.
	inWorld(): BasicCharacter | null {
		return this.spawned ? this.character : null;
	}

	// last known pose, for handing off to the offline map on a mode switch.
	pose(): PlayerPose | null {
		if (!this.spawned) return null;
		const {x, y, facing} = this.character;
		return {x, y, facing};
	}

	applyProfile(profile: Profile): void {
		applyAppearance(this.deps.renderer, this.character, profile);
	}

	// the local player's authoritative pose. on the controlling tab this is the
	// reconciliation anchor — snap onto it, replay our un-acked inputs on top; on
	// any other tab the avatar is driven elsewhere, so the pose is buffered and
	// interpolated exactly like a remote's.
	//
	// `ackTick` is the last of *our* inputs the server consumed, and `serverTick`
	// the tick our own clock is on — the replay window is the span between them.
	applyPose(pose: SnapshotPose, ackTick: number, serverTick: number, now: number): void {
		if (!this.controlling) {
			// another tab drives the avatar; buffer the authoritative pose for
			// interpolation instead of predicting.
			recordRemotePose(this.mirror, pose, now);
			return;
		}
		// a jump/teleport is a deterministic, input-locked animation the client
		// and server run identically but offset in time (our prediction leads the
		// server). suspend reconciliation while *either* side is mid-animation:
		// snapping to a mid-hop pose — which sits over a hole, illegal for walking
		// physics — would corrupt the replay and is the hole-hop jitter. the client
		// clears its own jump first (it leads), so pose.jumping covers the tail
		// window where the server is still hopping. reconciliation resumes once
		// both sides land, correcting any residual drift then.
		if (this.character.jump || this.character.teleport || pose.jumping) return;
		// replay from the ack up to the last tick we've locally simulated, to
		// rebuild the prediction on top of authoritative truth. anchoring on the
		// server's own tick instead would skip the first un-acked input every
		// snapshot, since that counter runs ahead of our ack.
		const toTick = serverTick - 1;
		// the ack can sit arbitrarily far behind toTick: a freshly resumed session
		// acks from its join tick, and a tab whose flushes stalled (backgrounded,
		// event loop saturated) freezes it while the server clock marches on. every
		// tick older than the input buffer's retention has been pruned and can only
		// replay NEUTRAL, so clamp the window to that depth — without it one
		// snapshot can demand millions of catch-up steps against a long-lived
		// server, which outruns the 100ms snapshot interval and melts the tab for
		// good.
		const fromTick = Math.max(ackTick, toTick - INPUT_MAX_AGE_TICKS);
		perfSample("replay ticks", toTick - fromTick);
		this.replayFrom(pose, fromTick, toTick);
	}

	// snaps the character onto the authoritative pose at `fromTick`, then replays
	// every recorded input from fromTick+1 to toTick on top of it.
	private replayFrom(authoritative: SnapshotPose, fromTick: number, toTick: number): void {
		const char = this.character;
		const inputs = this.deps.recordedInputs();
		placeCharacter(char, authoritative);
		char.walking = authoritative.walking;
		// anchor the walk-cycle phase to the authoritative value before replaying,
		// exactly as we do for position. without this the replay re-accumulates
		// animTimeMs for ticks that forward-stepping already counted, so the phase
		// double-counts and the walk animation lurches every snapshot.
		char.animTimeMs = decodeAnimByteMs(authoritative.animByte);
		for (let tick = fromTick + 1; tick <= toTick; tick++) {
			this.deps.world.stepOne(char, inputs.get(tick) ?? NEUTRAL_INPUT, TICK_DT_SEC);
		}
	}

	// prediction only runs on the controlling tab. the others render self via
	// the same snapshot interpolation remotes use — without it the uncontrolled
	// self would snap between authoritative poses at raw snapshot rate.
	syncControl(controlling: boolean): void {
		if (controlling === this.controlling) return;
		this.controlling = controlling;
		const char = this.character;
		this.mirror.samples.length = 0;
		if (controlling) {
			// prediction resumes from wherever interpolation left the character;
			// the next snapshot replay re-anchors it onto authoritative truth.
			cancelAirborne(char);
		} else if (this.spawned) {
			// seed interpolation at the current pose so the character holds
			// still until the first buffered snapshot arrives.
			this.mirror.samples.push(sampleFromCharacter(char, performance.now()));
		}
	}

	// brings the avatar into the world at the welcome's spawn, once the frame
	// loop is running. no-op on every frame but the first after a welcome.
	applyPendingSpawn(): void {
		const spawn = this.pendingSpawn;
		if (!spawn) return;
		this.pendingSpawn = null;
		this.spawn();
		placeCharacter(this.character, spawn);
		// a welcome resets the interp timeline too; fresh snapshots reseed it.
		this.mirror.samples.length = 0;
	}

	// poses the avatar from the buffer while another tab drives it. a no-op on
	// the controlling tab, whose pose comes from prediction instead.
	interpolate(renderAt: number): void {
		if (this.controlling || !this.spawned) return;
		applyRemoteInterp(this.mirror, renderAt);
	}

	// idempotent, so a resume/reconnect that re-welcomes doesn't double-register.
	private spawn(): void {
		if (this.spawned) return;
		// the character was built at map-load with the then-current avatar; the
		// player may have picked a different one before joining, so re-apply the
		// latest profile before the sprite first renders.
		this.applyProfile(this.deps.profile());
		this.deps.world.addCharacter(this.character, this.deps.inputs);
		this.spawned = true;
	}
}
