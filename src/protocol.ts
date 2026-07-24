import type {CharacterInput, Direction} from "@/game/types";
import type {HexColor} from "@/types";

// Wire protocol shared by client + server. JSON for control plane, binary
// DataView for snapshot fan-out.

export type ConnId = string;

// ws close codes with protocol meaning, shared so both sides agree.
// 1000/1008 are standard, 4xxx are ours.
export const CLOSE_NORMAL = 1000;
export const CLOSE_PROTOCOL = 1008;
export const CLOSE_SHUTDOWN = 4001;
export const CLOSE_SESSION_TAKEN = 4002;
export const CLOSE_SERVER_FULL = 4003;

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
			// `text` is always the obscenity-filtered version shown by default.
			// `rawText` carries the original and is present only when filtering
			// changed something, so clients can reveal it via the chat toggle.
			readonly text: string;
			readonly rawText?: string;
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

// per-kind backlog caps: presence/system churn (a bot swarm joining and
// leaving writes two presence entries per bot) must never evict conversation,
// so each kind competes only with itself for backlog slots.
export const CHAT_BACKLOG_CAPS: Readonly<Record<ChatMessage["kind"], number>> = {
	chat: 200,
	presence: 50,
	system: 20,
};

// appends to a chronologically ordered backlog, evicting the oldest entry of
// the same kind once that kind exceeds its cap. pushes are the only mutation,
// so a single eviction per push holds the invariant; the O(n) scans are
// trivial at the summed cap sizes.
export function pushBacklog(backlog: ChatMessage[], msg: ChatMessage): void {
	backlog.push(msg);
	let count = 0;
	for (const m of backlog) if (m.kind === msg.kind) count++;
	if (count <= CHAT_BACKLOG_CAPS[msg.kind]) return;
	const oldest = backlog.findIndex((m) => m.kind === msg.kind);
	backlog.splice(oldest, 1);
}

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

// hard cap on inputs carried by a single `input` message. the client buffers at
// most ~30s of ticks (INPUT_MAX_AGE_TICKS) and every batch is redundant, so a
// well-behaved client never approaches this; the server rejects anything larger
// as malformed, bounding the per-message work an attacker can impose.
export const MAX_INPUTS_PER_MESSAGE = 1024;

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

// the tab's viewport extent in world pixels (window size / camera scale). the
// server sizes this client's interest area from it so snapshots only carry
// players the client could actually display. capped at MAX_VIEW_WORLD_PX per
// axis for non-admins — the same cap the client enforces as its max zoom-out —
// so an inflated report can't widen the interest area past what a legitimate
// viewport could show.
export type ClientView = {readonly type: "view"; readonly w: number; readonly h: number};

export type ClientLeave = {readonly type: "leave"};

export type ClientMessage =
	| ClientHello
	| ClientSetProfile
	| ClientChat
	| ClientInput
	| ClientTeleport
	| ClientView
	| ClientLeave;

// --- Viewport / interest contract ----------------------------------------
// most world pixels a non-admin viewport may show per axis: the client derives
// its minimum zoom from this (window px / MAX_VIEW_WORLD_PX) and the server
// clamps reported view extents to it. admins are exempt on both ends. 768px is
// 48 tiles (16px) — 30% of the 160-tile map width at full zoom-out.
export const MAX_VIEW_WORLD_PX = 768;
// interest slack beyond the visible rect, covering interpolation delay, the
// camera spring lag and the server's coarser view of the camera. the exit
// margin is wider than the entry margin so a player oscillating on the
// boundary doesn't flap between included and removed every snapshot.
export const INTEREST_MARGIN_PX = 64;
export const INTEREST_EXIT_MARGIN_PX = 96;

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

// sent right before a server-initiated close to say why in words a bare close
// code can't carry (e.g. total cap vs per-IP cap). shown verbatim on the
// loading screen, so the text is user-facing copy.
export type ServerConnectionRejected = {
	readonly type: "connectionRejected";
	readonly message: string;
};

export type ServerJoin = {readonly type: "join"; readonly player: PlayerSnapshot};

export type ServerLeave = {readonly type: "leave"; readonly connId: ConnId};

export type ServerMessage =
	| ServerWelcome
	| ServerChat
	| ServerPresence
	| ServerSystem
	| ServerProfileChanged
	| ServerProfileRejected
	| ServerConnectionRejected
	| ServerJoin
	| ServerLeave;

// --- Binary snapshot codec ----------------------------------------------
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
		view.setUint8(offset + 12, Math.max(0, Math.min(255, Math.round(p.jumpOffset))));
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
