import {perfGauge} from "@/client/lib/perfHud";
import {InputBuffer} from "@/client/session/inputBuffer";
import {RoomMirror} from "@/client/session/net/roomMirror";
import {
	WsClient,
	type ConnectionError,
	type ConnectionStatus,
	type WsClientEvents,
	type WsClientOpts,
} from "@/client/session/net/wsClient";
import type {CharacterInput} from "@/shared/game/types";
import type {ClientMessage, ServerMessage, ServerWelcome} from "@/shared/protocol";
import type {DecodedSnapshot} from "@/shared/protocol/snapshot";

// all tabs share one identity (the resume token lives in localStorage), so
// only one tab may own the websocket — a second connection would steal the
// session and the tabs would kick each other forever. one tab is elected
// leader via the web locks api (the lock auto-releases when its tab dies, so
// failover needs no heartbeat protocol); it relays every server message and
// snapshot to the other tabs over a BroadcastChannel and forwards their
// outbound messages to the socket. every tab renders the world live; the tab
// with OS focus is the controller and drives the shared avatar.

const CHANNEL_NAME = "koholint:online-tabs";
const LEADER_LOCK = "koholint:online-leader";
// the leader posts a heartbeat so followers can tell a quiet-but-alive leader
// (ws down, nothing to relay) from a dead tab whose lock hasn't reached us.
const HEARTBEAT_MS = 1000;
const FOLLOWER_TICK_MS = 1000;
// snapshots relay at 10Hz and heartbeats every second, so a leader silent for
// this long is gone (or about to be replaced) — start asking around again.
const LEADER_STALE_MS = 2500;

// crypto.randomUUID exists only in secure contexts (https or localhost), so it
// is missing when the client is served over a plain-http lan ip. the tab id
// just needs to be unique per tab, not cryptographically random.
function randomTabId(): string {
	if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

// the channel is a broadcast, so every tab sees both directions of traffic. the
// union is split by which role a message is addressed to, which is what lets
// each handler below switch exhaustively over exactly the kinds it owes a case:
// a new kind becomes a compile error in the one handler that has to answer it,
// instead of something a catch-all silently absorbs.
type LeaderBound = {t: "hi"; from: string} | {t: "send"; msg: ClientMessage} | {t: "reconnect"};

type FollowerBound =
	// `snap` is the mirror's baseline of currently-visible poses: snapshots are
	// interest-culled deltas, so without it a late tab would never see players
	// that are on screen but static.
	| {
			t: "state";
			to: string;
			welcome: ServerWelcome;
			status: ConnectionStatus;
			snap: DecodedSnapshot | null;
	  }
	| {t: "server"; msg: ServerMessage}
	| {t: "snapshot"; snap: DecodedSnapshot}
	| {t: "status"; status: ConnectionStatus}
	| {t: "connError"; error: ConnectionError | null}
	| {t: "heartbeat"}
	| {t: "bye"};

type TabMessage = LeaderBound | FollowerBound;

// same-origin traffic from our own code; a shape check on the tag is enough.
function isTabMessage(data: unknown): data is TabMessage {
	return typeof data === "object" && data !== null && "t" in data && typeof data.t === "string";
}

function isLeaderBound(msg: TabMessage): msg is LeaderBound {
	return msg.t === "hi" || msg.t === "send" || msg.t === "reconnect";
}

// clears an interval if one is running and hands back the cleared slot, so a
// caller assigns the result rather than remembering to null the field itself.
function stopInterval(handle: ReturnType<typeof setInterval> | null): null {
	if (handle) clearInterval(handle);
	return null;
}

// the connection the page and game talk to. every tab creates one; internally
// it is either the leader (wrapping the real WsClient) or a follower (mirroring
// the leader's relay stream), and neither the page nor the game needs to know
// which. the input session — buffer plus server ack — lives here rather than in
// WsClient because it belongs to the tab, not to the socket: a follower records
// and replays inputs exactly like a leader, and a promotion mid-session must not
// hand the game a different buffer than the one it has been filling.
export class TabSyncedClient {
	private readonly opts: WsClientOpts;
	private readonly tabId = randomTabId();
	private events: WsClientEvents = {};
	private channel: BroadcastChannel | null = null;
	private leader: WsClient | null = null;
	private readonly mirror = new RoomMirror();
	private releaseLock: (() => void) | null = null;
	private lockAbort: AbortController | null = null;
	private started = false;

	private status: ConnectionStatus = "idle";
	private readonly inputBuffer = new InputBuffer();
	private lastServerAck = 0;
	// whether THIS tab has been admitted to the room — distinct from the leader
	// mirror's hasWelcome(), which asks whether the leader holds a welcome it
	// could synthesize a state reply from. leaderRelay depends on the difference.
	private admitted = false;
	private lastLeaderSignalAt = 0;
	private followerTimer: ReturnType<typeof setInterval> | null = null;
	private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

	constructor(opts: WsClientOpts) {
		this.opts = opts;
	}

	setEvents(events: WsClientEvents): void {
		this.events = events;
	}

	getStatus(): ConnectionStatus {
		return this.status;
	}

	// the focused tab drives the avatar. the browser gives keyboard focus to at
	// most one tab, so this is exclusive across tabs without any coordination;
	// when no tab is focused nobody flushes inputs and the server neutralizes.
	isController(): boolean {
		return document.hasFocus();
	}

	connect(): void {
		if (this.leader) {
			this.leader.connect();
			return;
		}
		if (this.started) {
			// reconnect click on a follower: whoever owns the socket retries.
			this.post({t: "reconnect"});
			return;
		}
		this.started = true;
		this.channel = new BroadcastChannel(CHANNEL_NAME);
		this.channel.addEventListener("message", (ev) => this.onChannelMessage(ev.data));
		this.emitStatus("connecting");
		this.post({t: "hi", from: this.tabId});
		this.followerTimer = setInterval(() => this.followerTick(), FOLLOWER_TICK_MS);
		this.acquireLeadership();
	}

	disconnect(): void {
		this.started = false;
		this.followerTimer = stopInterval(this.followerTimer);
		this.heartbeatTimer = stopInterval(this.heartbeatTimer);
		this.lockAbort?.abort();
		this.lockAbort = null;
		if (this.leader) {
			this.post({t: "bye"});
			this.leader.disconnect();
			this.leader = null;
		}
		// hands the lock to the next queued tab, which then resumes the session.
		this.releaseLock?.();
		this.releaseLock = null;
		this.channel?.close();
		this.channel = null;
		this.emitStatus("closed");
	}

	// leader and follower alike: the socket's owner is irrelevant to the tab's
	// own record of what it has sent and what the server has acknowledged.
	recordInput(tick: number, input: CharacterInput): void {
		this.inputBuffer.record(tick, input);
	}

	getRecordedInputs(): ReadonlyMap<number, CharacterInput> {
		return this.inputBuffer.entries();
	}

	flushInputs(currentTick: number): void {
		perfGauge("leader", this.leader ? 1 : 0);
		if (!this.isController()) return;
		const inputs = this.inputBuffer.collectUnacked(this.lastServerAck, currentTick);
		perfGauge("unacked inputs", inputs.length);
		if (inputs.length === 0) return;
		this.send({type: "input", ackTick: this.lastServerAck, inputs});
	}

	// the one outbound path: the leader writes to its socket, a follower hands
	// the message to whichever tab owns one. tabs share a server-side session but
	// can have different viewports; the server keeps whichever view report
	// arrived last, so the interest area follows the tab the user last used.
	send(msg: ClientMessage): void {
		if (this.leader) this.leader.send(msg);
		else this.post({t: "send", msg});
	}

	private acquireLeadership(): void {
		if (typeof navigator === "undefined" || !navigator.locks) {
			// no web locks: cross-tab election is impossible; act standalone.
			// a competing tab would be its own leader too and the session-taken
			// close (terminal in WsClient) settles who keeps the session.
			this.promote();
			return;
		}
		this.lockAbort = new AbortController();
		navigator.locks
			.request(LEADER_LOCK, {signal: this.lockAbort.signal}, () => {
				// torn down while queued: return nothing so the lock passes on.
				if (!this.started) return;
				this.promote();
				// hold the lock for this tab's lifetime; it releases on
				// disconnect() or when the browser reaps the tab, promoting the
				// next queued follower.
				return new Promise<void>((resolve) => {
					this.releaseLock = resolve;
				});
			})
			.catch(() => {
				// aborted by disconnect() before the lock was granted.
			});
	}

	private promote(): void {
		if (this.leader) return;
		this.followerTimer = stopInterval(this.followerTimer);
		this.heartbeatTimer = setInterval(() => this.post({t: "heartbeat"}), HEARTBEAT_MS);
		const inner = new WsClient(this.opts);
		this.leader = inner;
		inner.setEvents({
			onStatus: (status) => {
				this.post({t: "status", status});
				this.emitStatus(status);
			},
			onConnectionError: (error) => {
				this.post({t: "connError", error});
				this.events.onConnectionError?.(error);
			},
			onServerMessage: (msg) => this.leaderRelay(msg),
			onSnapshot: (snap) => {
				this.mirror.applySnapshot(snap);
				this.post({t: "snapshot", snap});
				this.applySnapshot(snap);
			},
		});
		inner.connect();
	}

	private leaderRelay(msg: ServerMessage): void {
		// a pre-welcome profileRejected is the hello/random-name recovery loop —
		// leader-local by design; the other tabs never sent that hello.
		if (msg.type === "profileRejected" && !this.mirror.hasWelcome()) {
			this.deliver(msg);
			return;
		}
		this.mirror.applyServer(msg);
		this.post({t: "server", msg});
		this.deliver(msg);
	}

	// routes on the message's direction as well as this tab's role: a follower
	// also sees its siblings' requests to the leader, and a leader sees the relay
	// it just posted. dropping the mismatches here is what keeps each handler
	// exhaustive over its own set.
	private onChannelMessage(data: unknown): void {
		if (!isTabMessage(data)) return;
		if (isLeaderBound(data)) {
			if (this.leader) this.onLeaderMessage(data);
		} else if (!this.leader) {
			this.onFollowerMessage(data);
		}
	}

	private onLeaderMessage(msg: LeaderBound): void {
		switch (msg.t) {
			case "hi": {
				const welcome = this.mirror.synthesizeWelcome();
				const status = this.leader?.getStatus();
				if (welcome && status)
					this.post({
						t: "state",
						to: msg.from,
						welcome,
						status,
						snap: this.mirror.synthesizeSnapshot(),
					});
				return;
			}
			case "send":
				// connection lifecycle stays the leader's own business; the rest
				// passes through verbatim, since both tabs speak the same protocol.
				if (msg.msg.type !== "hello" && msg.msg.type !== "leave")
					this.leader?.send(msg.msg);
				return;
			case "reconnect":
				this.leader?.connect();
				return;
		}
	}

	private onFollowerMessage(msg: FollowerBound): void {
		switch (msg.t) {
			case "state":
				if (msg.to !== this.tabId) return;
				this.noteLeaderSignal();
				this.emitStatus(msg.status);
				this.deliver(msg.welcome);
				if (msg.snap) this.applySnapshot(msg.snap);
				return;
			case "server":
				this.noteLeaderSignal();
				if (msg.msg.type === "welcome") this.emitStatus("connected");
				// before our own welcome the relay stream describes a room we
				// aren't in yet; the state reply is what admits us.
				if (msg.msg.type === "welcome" || this.admitted) this.deliver(msg.msg);
				return;
			case "snapshot":
				this.noteLeaderSignal();
				this.applySnapshot(msg.snap);
				return;
			case "status":
				this.noteLeaderSignal();
				// before our first welcome the widget-facing status stays
				// "connecting"; the state/welcome reply carries the real one.
				if (this.admitted) this.emitStatus(msg.status);
				return;
			case "connError":
				this.noteLeaderSignal();
				this.events.onConnectionError?.(msg.error);
				return;
			case "heartbeat":
				this.noteLeaderSignal();
				return;
			case "bye":
				// leader is leaving deliberately; poll fast for its successor.
				this.lastLeaderSignalAt = 0;
				this.emitStatus(this.admitted ? "resuming" : "connecting");
				return;
		}
	}

	// every server frame reaches the page through here, so the welcome's effect
	// on the input session is applied exactly once per tab however it arrived —
	// off our own socket, relayed, or in a state reply to a late join.
	private deliver(msg: ServerMessage): void {
		if (msg.type === "welcome") {
			this.admitted = true;
			this.lastServerAck = msg.serverTick;
			// pre-welcome inputs reference a tick frame that may no longer line
			// up with the server; drop them and let the page record fresh ones.
			this.inputBuffer.clear();
		}
		this.events.onServerMessage?.(msg);
	}

	private applySnapshot(snap: DecodedSnapshot): void {
		if (!this.admitted) return;
		if (snap.ackTickForYou > this.lastServerAck) this.lastServerAck = snap.ackTickForYou;
		this.inputBuffer.pruneUpTo(this.lastServerAck);
		this.events.onSnapshot?.(snap);
	}

	private followerTick(): void {
		if (Date.now() - this.lastLeaderSignalAt < LEADER_STALE_MS) return;
		// no leader in sight: either one exists and re-sends state, or the lock
		// is about to promote this tab (or a sibling, whose welcome relay will
		// re-sync us).
		if (this.admitted) this.emitStatus("resuming");
		this.post({t: "hi", from: this.tabId});
	}

	private noteLeaderSignal(): void {
		this.lastLeaderSignalAt = Date.now();
	}

	private emitStatus(status: ConnectionStatus): void {
		if (this.status === status) return;
		this.status = status;
		this.events.onStatus?.(status);
	}

	private post(msg: TabMessage): void {
		try {
			this.channel?.postMessage(msg);
		} catch {
			// channel closed mid-teardown.
		}
	}
}
