import type {CharacterInput} from "@/game/types";
import {InputBuffer} from "@/lib/inputBuffer";
import {perfGauge} from "@/lib/perfHud";
import {RoomMirror} from "@/lib/roomMirror";
import {
	WsClient,
	type ConnectionError,
	type ConnectionStatus,
	type WsClientEvents,
	type WsClientOpts,
} from "@/lib/wsClient";
import type {
	ClientMessage,
	DecodedSnapshot,
	Profile,
	ServerMessage,
	ServerWelcome,
} from "@/protocol";

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
// snapshots relay at 15Hz and heartbeats every second, so a leader silent for
// this long is gone (or about to be replaced) — start asking around again.
const LEADER_STALE_MS = 2500;

// crypto.randomUUID exists only in secure contexts (https or localhost), so it
// is missing when the client is served over a plain-http lan ip. the tab id
// just needs to be unique per tab, not cryptographically random.
function randomTabId(): string {
	if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

type TabMessage =
	| {t: "hi"; from: string}
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
	| {t: "send"; msg: ClientMessage}
	| {t: "reconnect"}
	| {t: "bye"};

// same-origin traffic from our own code; a shape check on the tag is enough.
function isTabMessage(data: unknown): data is TabMessage {
	return typeof data === "object" && data !== null && "t" in data && typeof data.t === "string";
}

// drop-in replacement for WsClient with the same event surface. every tab
// creates one; internally it is either the leader (wrapping the real WsClient)
// or a follower (mirroring the leader's relay stream). the page and game never
// need to know which.
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
	private hasWelcome = false;
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

	disconnect(reason?: string): void {
		this.started = false;
		this.stopTimer("followerTimer");
		this.stopTimer("heartbeatTimer");
		this.lockAbort?.abort();
		this.lockAbort = null;
		if (this.leader) {
			this.post({t: "bye"});
			this.leader.disconnect(reason ?? "client leave");
			this.leader = null;
		}
		// hands the lock to the next queued tab, which then resumes the session.
		this.releaseLock?.();
		this.releaseLock = null;
		this.channel?.close();
		this.channel = null;
		this.emitStatus("closed");
	}

	recordInput(tick: number, input: CharacterInput): void {
		if (this.leader) this.leader.recordInput(tick, input);
		else this.inputBuffer.record(tick, input);
	}

	getRecordedInputs(): ReadonlyMap<number, CharacterInput> {
		return this.leader ? this.leader.getRecordedInputs() : this.inputBuffer.entries();
	}

	flushInputs(currentTick: number): void {
		perfGauge("leader", this.leader ? 1 : 0);
		if (!this.isController()) return;
		if (this.leader) {
			this.leader.flushInputs(currentTick);
			return;
		}
		if (this.status !== "connected") return;
		const inputs = this.inputBuffer.collectUnacked(this.lastServerAck, currentTick);
		perfGauge("unacked inputs", inputs.length);
		if (inputs.length === 0) return;
		this.post({t: "send", msg: {type: "input", ackTick: this.lastServerAck, inputs}});
	}

	sendChat(text: string): void {
		if (this.leader) this.leader.sendChat(text);
		else this.post({t: "send", msg: {type: "chat", text}});
	}

	sendSetProfile(profile: Profile): void {
		if (this.leader) this.leader.sendSetProfile(profile);
		else this.post({t: "send", msg: {type: "setProfile", profile}});
	}

	sendTeleport(x: number, y: number): void {
		if (this.leader) this.leader.sendTeleport(x, y);
		else this.post({t: "send", msg: {type: "teleport", x, y}});
	}

	// tabs share one server-side session but can have different viewports; the
	// server keeps whichever report arrived last, so the interest area follows
	// the tab the user interacted with most recently.
	sendView(w: number, h: number): void {
		if (this.leader) this.leader.sendView(w, h);
		else this.post({t: "send", msg: {type: "view", w, h}});
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
		this.stopTimer("followerTimer");
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
			onWelcome: (msg) => this.leaderRelay(msg),
			onChat: (message) => this.leaderRelay({type: "chat", message}),
			onPresence: (message) => this.leaderRelay({type: "presence", message}),
			onSystem: (message) => this.leaderRelay({type: "system", message}),
			onJoin: (player) => this.leaderRelay({type: "join", player}),
			onLeave: (connId) => this.leaderRelay({type: "leave", connId}),
			onProfileChanged: (msg) => this.leaderRelay(msg),
			onProfileRejected: (msg) => this.leaderRelay(msg),
			onSnapshot: (snap) => {
				this.mirror.applySnapshot(snap);
				this.post({t: "snapshot", snap});
				this.events.onSnapshot?.(snap);
			},
		});
		inner.connect();
	}

	private leaderRelay(msg: ServerMessage): void {
		// a pre-welcome profileRejected is the hello/random-name recovery loop —
		// leader-local by design; the other tabs never sent that hello.
		if (msg.type === "profileRejected" && !this.mirror.hasWelcome()) {
			this.dispatchToPage(msg);
			return;
		}
		this.mirror.applyServer(msg);
		this.post({t: "server", msg});
		this.dispatchToPage(msg);
	}

	private onChannelMessage(data: unknown): void {
		if (!isTabMessage(data)) return;
		if (this.leader) this.onLeaderMessage(data);
		else this.onFollowerMessage(data);
	}

	private onLeaderMessage(msg: TabMessage): void {
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
				return this.forwardToServer(msg.msg);
			case "reconnect":
				this.leader?.connect();
				return;
			default:
				return;
		}
	}

	private forwardToServer(msg: ClientMessage): void {
		const inner = this.leader;
		if (!inner) return;
		switch (msg.type) {
			case "input":
				return inner.sendInputBatch(msg.ackTick, msg.inputs);
			case "chat":
				return inner.sendChat(msg.text);
			case "setProfile":
				return inner.sendSetProfile(msg.profile);
			case "teleport":
				return inner.sendTeleport(msg.x, msg.y);
			case "view":
				return inner.sendView(msg.w, msg.h);
			case "hello":
			case "leave":
				// connection lifecycle stays the leader's own business.
				return;
		}
	}

	private onFollowerMessage(msg: TabMessage): void {
		switch (msg.t) {
			case "state":
				if (msg.to !== this.tabId) return;
				this.noteLeaderSignal();
				this.emitStatus(msg.status);
				this.applyWelcome(msg.welcome);
				if (msg.snap) this.applySyncedSnapshot(msg.snap);
				return;
			case "server":
				this.noteLeaderSignal();
				if (msg.msg.type === "welcome") {
					this.emitStatus("connected");
					this.applyWelcome(msg.msg);
					return;
				}
				if (this.hasWelcome) this.dispatchToPage(msg.msg);
				return;
			case "snapshot":
				this.noteLeaderSignal();
				this.applySyncedSnapshot(msg.snap);
				return;
			case "status":
				this.noteLeaderSignal();
				// before our first welcome the widget-facing status stays
				// "connecting"; the state/welcome reply carries the real one.
				if (this.hasWelcome) this.emitStatus(msg.status);
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
				this.emitStatus(this.hasWelcome ? "resuming" : "connecting");
				return;
			case "hi":
			case "send":
			case "reconnect":
				// leader-directed traffic from sibling followers.
				return;
		}
	}

	private applyWelcome(welcome: ServerWelcome): void {
		this.hasWelcome = true;
		this.lastServerAck = welcome.serverTick;
		// pre-welcome inputs reference a tick frame that may no longer line up
		// with the server; drop them, matching WsClient's welcome handling.
		this.inputBuffer.clear();
		this.events.onWelcome?.(welcome);
	}

	private applySyncedSnapshot(snap: DecodedSnapshot): void {
		if (!this.hasWelcome) return;
		if (snap.ackTickForYou > this.lastServerAck) this.lastServerAck = snap.ackTickForYou;
		this.inputBuffer.pruneUpTo(this.lastServerAck);
		this.events.onSnapshot?.(snap);
	}

	private followerTick(): void {
		if (Date.now() - this.lastLeaderSignalAt < LEADER_STALE_MS) return;
		// no leader in sight: either one exists and re-sends state, or the lock
		// is about to promote this tab (or a sibling, whose welcome relay will
		// re-sync us).
		if (this.hasWelcome) this.emitStatus("resuming");
		this.post({t: "hi", from: this.tabId});
	}

	private noteLeaderSignal(): void {
		this.lastLeaderSignalAt = Date.now();
	}

	private dispatchToPage(msg: ServerMessage): void {
		switch (msg.type) {
			case "welcome":
				return this.events.onWelcome?.(msg);
			case "chat":
				return this.events.onChat?.(msg.message);
			case "presence":
				return this.events.onPresence?.(msg.message);
			case "system":
				return this.events.onSystem?.(msg.message);
			case "join":
				return this.events.onJoin?.(msg.player);
			case "leave":
				return this.events.onLeave?.(msg.connId);
			case "profileChanged":
				return this.events.onProfileChanged?.(msg);
			case "profileRejected":
				return this.events.onProfileRejected?.(msg);
		}
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

	private stopTimer(key: "followerTimer" | "heartbeatTimer"): void {
		const handle = this[key];
		if (!handle) return;
		clearInterval(handle);
		this[key] = null;
	}
}
