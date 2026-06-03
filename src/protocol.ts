import type {CharacterInput, Direction} from "@/game/types";
import type {HexColor} from "@/types";

// Wire protocol shared by client + server. JSON for control plane, binary
// DataView for snapshot fan-out (decision documented in HANDOFF.md).

export type ConnId = string;

export type Profile = {
	readonly name: string;
	readonly avatarId: string;
	readonly paletteId: string | null;
};

export type ChatMessage =
	| {
			readonly id: string;
			readonly kind: "chat";
			readonly senderId: ConnId;
			readonly name: string;
			readonly color: HexColor;
			readonly avatarId: string;
			readonly paletteId: string | null;
			readonly text: string;
			readonly timestamp: number;
	  }
	| {
			readonly id: string;
			readonly kind: "system";
			readonly text: string;
			readonly timestamp: number;
	  }
	| {
			readonly id: string;
			readonly kind: "presence";
			readonly action: "join" | "leave" | "reconnect";
			readonly senderId: ConnId;
			readonly name: string;
			readonly color: HexColor;
			readonly avatarId: string;
			readonly paletteId: string | null;
			readonly timestamp: number;
	  };

export type PlayerSnapshot = {
	readonly connId: ConnId;
	readonly idIndex: number;
	readonly profile: Profile;
	readonly color: HexColor;
	readonly x: number;
	readonly y: number;
	readonly facing: Direction;
};

export type CoalescedInput = {
	readonly tick: number;
	readonly input: CharacterInput;
};

// --- Client -> Server ----------------------------------------------------

export type ClientHello = {
	readonly type: "hello";
	readonly name: string;
	readonly avatarId: string;
	readonly paletteId: string | null;
	readonly adminToken?: string;
	readonly resumeToken?: string;
};

export type ClientSetProfile = {readonly type: "setProfile"; readonly profile: Profile};

export type ClientChat = {readonly type: "chat"; readonly text: string};

export type ClientInput = {
	readonly type: "input";
	readonly ackTick: number;
	readonly inputs: ReadonlyArray<CoalescedInput>;
};

export type ClientTeleport = {readonly type: "teleport"; readonly x: number; readonly y: number};

export type ClientLeave = {readonly type: "leave"};

export type ClientMessage =
	| ClientHello
	| ClientSetProfile
	| ClientChat
	| ClientInput
	| ClientTeleport
	| ClientLeave;

// --- Server -> Client ----------------------------------------------------

export type ServerWelcome = {
	readonly type: "welcome";
	readonly connId: ConnId;
	readonly isAdmin: boolean;
	readonly serverTick: number;
	readonly serverTimeMs: number;
	readonly resumeToken: string;
	readonly spawn: {readonly x: number; readonly y: number};
	readonly players: ReadonlyArray<PlayerSnapshot>;
	readonly chatBacklog: ReadonlyArray<ChatMessage>;
};

export type ServerChat = {readonly type: "chat"; readonly message: ChatMessage};

export type ServerPresence = {readonly type: "presence"; readonly message: ChatMessage};

export type ServerSystem = {readonly type: "system"; readonly message: ChatMessage};

export type ServerProfileChanged = {
	readonly type: "profileChanged";
	readonly connId: ConnId;
	readonly profile: Profile;
	readonly color: HexColor;
};

export type ServerProfileRejected = {readonly type: "profileRejected"; readonly reason: string};

export type ServerJoin = {readonly type: "join"; readonly player: PlayerSnapshot};

export type ServerLeave = {readonly type: "leave"; readonly connId: ConnId};

export type ServerMessage =
	| ServerWelcome
	| ServerChat
	| ServerPresence
	| ServerSystem
	| ServerProfileChanged
	| ServerProfileRejected
	| ServerJoin
	| ServerLeave;

// --- Binary snapshot codec ----------------------------------------------
// Layout: u32 serverTick, u32 ackTickForYou, u16 playerCount,
// then per-player: u16 idIndex, f32 x, f32 y, u8 dirFlags, u8 animByte,
// u8 jumpByte. dirFlags packs facing (bits 0-1), a walking flag (bit 2), and a
// jumping flag (bit 3). jumpByte is the vertical hop/teleport lift in whole
// pixels (0-255), letting remotes arc rather than slide across a hole.
//
// ackTickForYou is u32 (not u16): it carries an unbounded tick counter that
// the client uses as the reconciliation anchor, so a u16 would wrap after
// ~36min and make the replay bound (toTick - ackTickForYou) explode.
//
// Player ids are stable u16 indices assigned by the server at hello time.
// The mapping is broadcast in `welcome` (and in `join`) so clients can
// resolve idIndex -> connId without putting a string in every frame.

export const SNAPSHOT_HEADER_BYTES = 4 + 4 + 2;
export const SNAPSHOT_PLAYER_BYTES = 2 + 4 + 4 + 1 + 1 + 1;

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
	poses: ReadonlyArray<SnapshotPose>
): ArrayBuffer {
	const buf = new ArrayBuffer(SNAPSHOT_HEADER_BYTES + poses.length * SNAPSHOT_PLAYER_BYTES);
	const view = new DataView(buf);
	view.setUint32(0, serverTick >>> 0, true);
	view.setUint32(4, ackTickForYou >>> 0, true);
	view.setUint16(8, poses.length & 0xffff, true);
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
		view.setUint8(offset + 12, Math.max(0, Math.min(255, Math.round(p.jumpOffset))));
		offset += SNAPSHOT_PLAYER_BYTES;
	}
	return buf;
}

export type DecodedSnapshot = {
	readonly serverTick: number;
	readonly ackTickForYou: number;
	readonly poses: ReadonlyArray<SnapshotPose>;
};

export function decodeSnapshot(buf: ArrayBuffer): DecodedSnapshot {
	const view = new DataView(buf);
	const serverTick = view.getUint32(0, true);
	const ackTickForYou = view.getUint32(4, true);
	const count = view.getUint16(8, true);
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
	return {serverTick, ackTickForYou, poses};
}
