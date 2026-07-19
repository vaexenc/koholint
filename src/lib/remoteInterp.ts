import {lerp, type BasicCharacter} from "@/game";
import {type Direction} from "@/game/types";
import {decodeAnimByteMs, type ConnId, type Profile, type SnapshotPose} from "@/protocol";

// render remote players this far behind the latest snapshot so we always have
// two frames bracketing the render time. ~1.5x the 66ms snapshot interval.
export const REMOTE_INTERP_DELAY_MS = 100;

// how long to retain past samples. must comfortably exceed REMOTE_INTERP_DELAY_MS
// so the buffer always holds a pair bracketing the render time, even when a
// snapshot arrives late.
const REMOTE_SAMPLE_HISTORY_MS = 500;

export type RemotePoseSample = {
	x: number;
	y: number;
	facing: Direction;
	walking: boolean;
	animByte: number;
	jumpOffset: number;
	at: number;
};

// the minimum surface the interpolation functions need: a character to pose
// and its sample buffer. remotes carry it inside RemoteEntry; the self
// character uses a bare PoseMirror while another tab controls the avatar.
export type PoseMirror = {
	character: BasicCharacter;
	// snapshot-interpolation buffer, ascending by `at` (ws delivery is ordered so
	// samples never arrive out of sequence). we render REMOTE_INTERP_DELAY_MS in
	// the past and lerp between whichever pair brackets that render time, so we
	// need more than two samples buffered to cover the delay plus network jitter.
	samples: RemotePoseSample[];
};

export type RemoteEntry = PoseMirror & {
	connId: ConnId;
	idIndex: number;
	profile: Profile;
	color: string;
};

// positions the remote sprite at renderAt by lerping between the two buffered
// samples that bracket it. consecutive segments share endpoints, so motion is
// continuous regardless of uneven snapshot arrival spacing. clamps (never
// extrapolates) at the buffer ends — before the oldest sample we hold the
// oldest, past the newest we hold the newest — which falls out of the same lerp
// for free once we pick lo === hi and t === 0 for those cases.
export function applyRemoteInterp(remote: PoseMirror, renderAt: number): void {
	const samples = remote.samples;
	if (samples.length === 0) return;
	const char = remote.character;
	// the segment [lo, hi] bracketing renderAt and how far across it we are.
	// default to the newest sample, which covers renderAt past the buffer's end.
	let lo = samples[samples.length - 1];
	let hi = lo;
	let t = 0;
	if (renderAt <= samples[0].at) {
		lo = hi = samples[0]; // before the buffer's start: hold the oldest.
	} else if (renderAt < hi.at) {
		for (let i = 0; i < samples.length - 1; i++) {
			if (renderAt <= samples[i + 1].at) {
				lo = samples[i];
				hi = samples[i + 1];
				const span = hi.at - lo.at;
				t = span > 0 ? (renderAt - lo.at) / span : 0;
				break;
			}
		}
	}
	char.x = char.prevX = lerp(lo.x, hi.x, t);
	char.y = char.prevY = lerp(lo.y, hi.y, t);
	// advance the walk phase smoothly across the segment instead of snapping it
	// at each snapshot. animByte climbs monotonically while walking; a drop means
	// it reset on stop (or wrapped at the end of a walk cycle), so we hold the
	// newer value rather than interpolate backward through it.
	const animByte = hi.animByte >= lo.animByte ? lerp(lo.animByte, hi.animByte, t) : hi.animByte;
	char.animTimeMs = decodeAnimByteMs(animByte);
	// lerp the hop arc too so remotes rise/fall smoothly over a hole.
	char.jumpOffsetY = char.prevJumpOffsetY = lerp(lo.jumpOffset, hi.jumpOffset, t);
	// facing/walking come from the sample we're moving toward (the nearest
	// endpoint when clamped).
	char.facing = hi.facing;
	char.walking = hi.walking;
}

export function recordRemotePose(remote: PoseMirror, pose: SnapshotPose, at: number): void {
	const samples = remote.samples;
	samples.push({
		x: pose.x,
		y: pose.y,
		facing: pose.facing,
		walking: pose.walking,
		animByte: pose.animByte,
		jumpOffset: pose.jumpOffset,
		at,
	});
	// evict samples older than the history window, but always keep at least two
	// so there's still a segment to interpolate across.
	const cutoff = at - REMOTE_SAMPLE_HISTORY_MS;
	while (samples.length > 2 && samples[0].at < cutoff) samples.shift();
}
