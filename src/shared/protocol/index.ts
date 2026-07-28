import type {CharacterInput, Direction} from "@/shared/game/types";
import type {HexColor} from "@/shared/sprites/types";

// the JSON control plane shared by client + server: identity, chat, presence,
// and the client's commands. the binary pose fan-out is its own module
// (@/shared/protocol/snapshot) and is imported directly by the few places that speak
// it.
//
// the rest of the package is everything else both ends have to agree on, and is
// likewise imported by module: ./guards (the primitive shape checks the two
// trust boundaries share), ./parseProfile, ./validateName, and ./feedback — the
// one contract that rides the HTTP api rather than the socket.

export type ConnId = string;

// ws close codes with protocol meaning, shared so both sides agree.
// 1000/1008 are standard, 4xxx are ours.
export const CLOSE_NORMAL = 1000;
export const CLOSE_PROTOCOL = 1008;
export const CLOSE_SHUTDOWN = 4001;
export const CLOSE_SESSION_TAKEN = 4002;
export const CLOSE_SERVER_FULL = 4003;

// --- Simulation timing contract ------------------------------------------
// the rate the authoritative simulation runs at. clients step prediction at the
// same rate and stamp inputs in this numbering, so both ends must read it from
// here — a rate that differs by even one tick between them makes every
// predicted position wrong.
export const TICK_HZ = 30;
// snapshots fire every round(TICK_HZ / SNAPSHOT_HZ) ticks, so keep this a
// divisor of TICK_HZ or the effective rate silently quantizes to another value.
export const SNAPSHOT_HZ = 10;
// how far ahead of its own serverTick the server still accepts a stamped input.
// clients stamp against an estimate of the server clock, so a small lead is
// normal (latency + skew); a second's worth of lookahead covers it, and ticks
// beyond that would sit unconsumed.
export const MAX_INPUT_LOOKAHEAD_TICKS = TICK_HZ;
// how far ahead clients deliberately stamp, so an input arrives before the
// server's counter reaches its tick (it consumes an input only on the exact
// matching tick). ~130ms at 30Hz, about one typical RTT.
export const INPUT_LEAD_TICKS = 4;
// ceiling on how far a client's estimate may lead the newest snapshot. half the
// server's acceptance window, leaving jitter headroom so stamped inputs stay
// consumable even when the estimate is running hot.
export const MAX_INPUT_LEAD_TICKS = Math.floor(MAX_INPUT_LOOKAHEAD_TICKS / 2);

export type Profile = {
	readonly name: string;
	readonly avatarId: string;
	readonly paletteId: string | null;
};

// the sender stamped onto every line that has one. chat and presence flatten
// identity the same way, so the shape is declared once here — the server fills
// it from a session, the client rebuilds it at the trust boundary, and neither
// can grow a field the other doesn't know about.
export type ChatSender = {
	readonly senderId: ConnId;
	readonly name: string;
	readonly color: HexColor;
	readonly avatarId: string;
	readonly paletteId: string | null;
};

export type ChatMessage =
	| (ChatSender & {
			readonly id: string;
			readonly kind: "chat";
			// `text` is always the obscenity-filtered version shown by default.
			// `rawText` carries the original and is present only when filtering
			// changed something, so clients can reveal it via the chat toggle.
			readonly text: string;
			readonly rawText?: string;
			readonly timestamp: number;
	  })
	| {
			readonly id: string;
			readonly kind: "system";
			readonly text: string;
			readonly timestamp: number;
	  }
	| (ChatSender & {
			readonly id: string;
			readonly kind: "presence";
			readonly action: "join" | "leave" | "reconnect";
			readonly timestamp: number;
	  });

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

// longest chat line the server keeps; anything past this is truncated on
// arrival. shared so the compose box stops the player at the same length rather
// than letting them type into silence.
export const CHAT_MAX_LENGTH = 500;

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

// one envelope for every backlog entry — conversation, presence and system
// lines alike. which it is lives in `message.kind`, where the welcome's backlog
// already carries it, so an envelope per kind would only restate that.
export type ServerChat = {readonly type: "chat"; readonly message: ChatMessage};

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
	| ServerProfileChanged
	| ServerProfileRejected
	| ServerConnectionRejected
	| ServerJoin
	| ServerLeave;
