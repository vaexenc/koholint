import type {Direction} from "@/shared/game/types";
import {clamp} from "@/shared/lib/math";

// the binary snapshot codec: the pose fan-out's wire format, and the only part
// of the protocol that isn't JSON. it shares nothing with the control plane in
// ./index but the connection it travels over, so it is imported explicitly
// (@/shared/protocol/snapshot) rather than re-exported through the root — a consumer
// of the control plane has no business seeing byte offsets.
//
// Layout: u32 serverTick, u32 ackTickForYou, u16 playerCount, u16 removedCount,
// then per-player: u16 idIndex, f32 x, f32 y, u8 dirFlags, u8 animByte,
// u8 jumpByte, then removedCount u16 idIndexes. dirFlags packs facing
// (bits 0-1), a walking flag (bit 2), and a jumping flag (bit 3). jumpByte is
// the vertical hop/teleport lift in whole pixels (0-255), letting remotes arc
// rather than slide across a hole.
//
// snapshots are per-recipient deltas: a pose appears only when it entered the
// recipient's interest area or changed since the previous snapshot round, so a
// missing idIndex means "unchanged", not "gone". the removed list is the
// explicit "left your interest area" signal — the client despawns those
// remotes. the recipient's own pose is echoed every snapshot regardless, so
// prediction/reconciliation never depends on the delta rules.
//
// ackTickForYou is u32 (not u16): it carries an unbounded tick counter that
// the client uses as the reconciliation anchor, so a u16 would wrap after
// ~36min and make the replay bound (toTick - ackTickForYou) explode.
//
// Player ids are stable u16 indices assigned by the server at hello time.
// The mapping is broadcast in `welcome` (and in `join`) so clients can
// resolve idIndex -> connId without putting a string in every frame.

export const SNAPSHOT_HEADER_BYTES = 4 + 4 + 2 + 2;
export const SNAPSHOT_PLAYER_BYTES = 2 + 4 + 4 + 1 + 1 + 1;

// walk-phase wire encoding. the simulation keeps animTimeMs bounded so the byte
// never saturates; encodeAnimByte/decodeAnimByteMs are the one home for the
// contract so the conversion can't drift between server and clients.
export const ANIM_BYTE_SCALE_MS = 16;
export const ANIM_BYTE_MAX = 255;

// the min is a guard, not a live path: animTimeMs is bounded upstream so the
// rounded byte stays under ANIM_BYTE_MAX in normal operation.
export const encodeAnimByte = (animTimeMs: number): number =>
	Math.min(ANIM_BYTE_MAX, Math.round(animTimeMs / ANIM_BYTE_SCALE_MS));

export const decodeAnimByteMs = (animByte: number): number => animByte * ANIM_BYTE_SCALE_MS;

export const DIR_DOWN = 0;
export const DIR_LEFT = 1;
export const DIR_UP = 2;
export const DIR_RIGHT = 3;

export type SnapshotPose = {
	readonly idIndex: number;
	readonly x: number;
	readonly y: number;
	readonly facing: Direction;
	readonly walking: boolean;
	// true while the character is mid-jump or mid-teleport — an input-locked,
	// deterministic animation whose in-flight state isn't otherwise on the wire.
	// the self client uses it to suspend reconciliation: the server runs the same
	// animation but offset in time from the client's prediction, so snapping to a
	// mid-jump (over-a-hole) pose would corrupt the local hop.
	readonly jumping: boolean;
	readonly animByte: number;
	// vertical hop/teleport lift in pixels, sent so remotes arc over holes
	// instead of sliding across. clamped to a byte on the wire.
	readonly jumpOffset: number;
};

const FACING_TO_DIR: Record<Direction, number> = {
	down: DIR_DOWN,
	left: DIR_LEFT,
	up: DIR_UP,
	right: DIR_RIGHT,
};

const DIR_TO_FACING: Direction[] = ["down", "left", "up", "right"];

const WALKING_FLAG = 1 << 2;
const JUMPING_FLAG = 1 << 3;

export function encodeSnapshot(
	serverTick: number,
	ackTickForYou: number,
	poses: ReadonlyArray<SnapshotPose>,
	removed: ReadonlyArray<number>
): ArrayBuffer {
	const buf = new ArrayBuffer(
		SNAPSHOT_HEADER_BYTES + poses.length * SNAPSHOT_PLAYER_BYTES + removed.length * 2
	);
	const view = new DataView(buf);
	view.setUint32(0, serverTick >>> 0, true);
	view.setUint32(4, ackTickForYou >>> 0, true);
	view.setUint16(8, poses.length & 0xffff, true);
	view.setUint16(10, removed.length & 0xffff, true);
	let offset = SNAPSHOT_HEADER_BYTES;
	for (const p of poses) {
		view.setUint16(offset, p.idIndex & 0xffff, true);
		view.setFloat32(offset + 2, p.x, true);
		view.setFloat32(offset + 6, p.y, true);
		const dirByte =
			(FACING_TO_DIR[p.facing] & 0x03) |
			(p.walking ? WALKING_FLAG : 0) |
			(p.jumping ? JUMPING_FLAG : 0);
		view.setUint8(offset + 10, dirByte);
		view.setUint8(offset + 11, p.animByte & 0xff);
		view.setUint8(offset + 12, clamp(Math.round(p.jumpOffset), 0, 255));
		offset += SNAPSHOT_PLAYER_BYTES;
	}
	for (const idIndex of removed) {
		view.setUint16(offset, idIndex & 0xffff, true);
		offset += 2;
	}
	return buf;
}

export type DecodedSnapshot = {
	readonly serverTick: number;
	readonly ackTickForYou: number;
	readonly poses: ReadonlyArray<SnapshotPose>;
	// idIndexes that left this client's interest area — despawn their remotes.
	readonly removed: ReadonlyArray<number>;
};

export function decodeSnapshot(buf: ArrayBuffer): DecodedSnapshot {
	const view = new DataView(buf);
	const serverTick = view.getUint32(0, true);
	const ackTickForYou = view.getUint32(4, true);
	const count = view.getUint16(8, true);
	const removedCount = view.getUint16(10, true);
	const poses: SnapshotPose[] = [];
	let offset = SNAPSHOT_HEADER_BYTES;
	for (let i = 0; i < count; i++) {
		const idIndex = view.getUint16(offset, true);
		const x = view.getFloat32(offset + 2, true);
		const y = view.getFloat32(offset + 6, true);
		const dirByte = view.getUint8(offset + 10);
		const animByte = view.getUint8(offset + 11);
		const jumpOffset = view.getUint8(offset + 12);
		poses.push({
			idIndex,
			x,
			y,
			facing: DIR_TO_FACING[dirByte & 0x03],
			walking: (dirByte & WALKING_FLAG) !== 0,
			jumping: (dirByte & JUMPING_FLAG) !== 0,
			animByte,
			jumpOffset,
		});
		offset += SNAPSHOT_PLAYER_BYTES;
	}
	const removed: number[] = [];
	for (let i = 0; i < removedCount; i++) {
		removed.push(view.getUint16(offset, true));
		offset += 2;
	}
	return {serverTick, ackTickForYou, poses, removed};
}
