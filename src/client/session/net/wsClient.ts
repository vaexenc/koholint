import {getStored, setStored} from "@/client/lib/safeStorage";
import {parseServerMessage} from "@/client/session/net/parseServerMessage";
import {
	CLOSE_NORMAL,
	CLOSE_PROTOCOL,
	CLOSE_SERVER_FULL,
	CLOSE_SESSION_TAKEN,
	type ClientMessage,
	type Profile,
	type ServerMessage,
	type ServerWelcome,
} from "@/shared/protocol";
import {decodeSnapshot, type DecodedSnapshot} from "@/shared/protocol/snapshot";

export type ConnectionStatus = "idle" | "connecting" | "resuming" | "connected" | "closed";

// why the last connection attempt failed, for UI copy; null once welcomed.
// serverFull/unreachable keep retrying; sessionTaken (auto-reconnecting would
// steal the session right back and the two clients would kick each other
// forever) and rejected are terminal. `message` carries server-authored copy
// from a pre-close connectionRejected frame, when one arrived.
export type ConnectionError = {
	readonly kind: "serverFull" | "sessionTaken" | "rejected" | "unreachable";
	readonly message?: string;
};

export const RESUME_TOKEN_KEY = "koholint:resumeToken";

// the ws endpoint always lives on the page's own origin — vite proxies /ws to
// the game server in dev and preview alike — so every consumer derives it here.
export function buildWsUrl(): string {
	const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
	return `${proto}//${window.location.host}/ws`;
}

// 1->2->4->8s retry backoff; the last entry repeats forever. shared with the
// offline fallback's reachability probe so a down server is retried at one rate.
const RETRY_BACKOFFS_MS = [1000, 2000, 4000, 8000];

export function retryDelayMs(attempt: number): number {
	return RETRY_BACKOFFS_MS[Math.min(attempt, RETRY_BACKOFFS_MS.length - 1)];
}
// bound on auto-retries after a rejected hello (CLOSE_PROTOCOL before welcome —
// the page swaps in a fresh random name on each profileRejected). guards
// against a pathological reject loop when fresh random names keep failing.
const MAX_HELLO_REJECTS = 3;

// the only outbound kinds worth holding while the socket is down. a profile
// edit has to survive the reconnect that will carry it; everything else is only
// meaningful at the moment it was made — stale inputs are worthless after a
// resume, and the server re-establishes chat, view and position on welcome.
const QUEUED_WHILE_DOWN: ReadonlySet<ClientMessage["type"]> = new Set(["setProfile"]);

export type WsClientOpts = {
	readonly url: string;
	readonly getProfile: () => Profile;
	readonly getAdminToken: () => string | undefined;
};

export type WsClientEvents = {
	onStatus?(status: ConnectionStatus): void;
	onConnectionError?(error: ConnectionError | null): void;
	// every server frame in arrival order, welcome included. this client reads
	// the connection-level ones (welcome's resume token, connectionRejected's
	// copy) on the way past; interpreting the rest is the caller's job.
	onServerMessage?(msg: ServerMessage): void;
	onSnapshot?(snapshot: DecodedSnapshot): void;
};

// thin wire-layer wrapper around a single ws connection: reconnect with
// backoff, the hello handshake, the resume-token round-trip and the outbox.
// DOM-aware (WebSocket + localStorage) but render-free, and it holds no game
// state — the input buffer, the roster and the world all live above it.
export class WsClient {
	private readonly opts: WsClientOpts;
	private events: WsClientEvents = {};
	private socket: WebSocket | null = null;
	private status: ConnectionStatus = "idle";
	private hasEverConnected = false;
	private reconnectAttempt = 0;
	private helloRejects = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private intentionalClose = false;
	// connectionRejected text from the current socket, consumed by onClose.
	private rejectMessage: string | null = null;
	private outbox: ClientMessage[] = [];

	constructor(opts: WsClientOpts) {
		this.opts = opts;
	}

	setEvents(events: WsClientEvents): void {
		this.events = events;
	}

	getStatus(): ConnectionStatus {
		return this.status;
	}

	connect(): void {
		if (this.socket || this.reconnectTimer) return;
		this.intentionalClose = false;
		this.openSocket();
	}

	disconnect(): void {
		this.intentionalClose = true;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		const live = this.socket;
		if (live?.readyState === WebSocket.OPEN) this.sendNow({type: "leave"});
		this.socket = null;
		try {
			live?.close(CLOSE_NORMAL, "client leave");
		} catch {
			// noop
		}
		this.setStatus("closed");
	}

	send(msg: ClientMessage): void {
		if (this.status === "connected" && this.socket?.readyState === WebSocket.OPEN) {
			this.sendNow(msg);
			return;
		}
		if (QUEUED_WHILE_DOWN.has(msg.type)) this.outbox.push(msg);
	}

	private sendNow(msg: ClientMessage): void {
		try {
			this.socket?.send(JSON.stringify(msg));
		} catch {
			// socket closed mid-send; reconnect path will retake responsibility.
		}
	}

	private openSocket(): void {
		this.setStatus(this.hasEverConnected ? "resuming" : "connecting");
		// a fresh attempt must not inherit the previous socket's reject text.
		this.rejectMessage = null;
		const socket = new WebSocket(this.opts.url);
		socket.binaryType = "arraybuffer";
		this.socket = socket;
		socket.addEventListener("open", () => this.onOpen());
		socket.addEventListener("message", (ev) => this.onMessage(ev));
		socket.addEventListener("close", (ev) => this.onClose(ev));
		// errors always precede a close event; we handle reconnect from there.
		socket.addEventListener("error", () => undefined);
	}

	private onOpen(): void {
		const profile = this.opts.getProfile();
		const adminToken = this.opts.getAdminToken();
		const resumeToken = getStored(RESUME_TOKEN_KEY);
		this.sendNow({
			type: "hello",
			name: profile.name,
			avatarId: profile.avatarId,
			paletteId: profile.paletteId,
			adminToken: adminToken || undefined,
			resumeToken: resumeToken || undefined,
		});
	}

	private onMessage(ev: MessageEvent): void {
		if (ev.data instanceof ArrayBuffer) {
			this.events.onSnapshot?.(decodeSnapshot(ev.data));
			return;
		}
		if (typeof ev.data !== "string") return;
		const msg = parseServerMessage(ev.data);
		if (!msg) return;
		if (msg.type === "welcome") {
			this.onWelcome(msg);
			return;
		}
		if (msg.type === "connectionRejected") {
			// remembered, not emitted: the close that follows carries the kind,
			// and emitting once there keeps error state single-sourced.
			this.rejectMessage = msg.message;
			return;
		}
		this.events.onServerMessage?.(msg);
	}

	private onWelcome(msg: ServerWelcome): void {
		setStored(RESUME_TOKEN_KEY, msg.resumeToken);
		this.hasEverConnected = true;
		this.reconnectAttempt = 0;
		this.helloRejects = 0;
		this.setStatus("connected");
		this.events.onConnectionError?.(null);
		this.events.onServerMessage?.(msg);
		for (const queued of this.outbox.splice(0)) this.sendNow(queued);
	}

	private onClose(ev: CloseEvent): void {
		this.socket = null;
		if (this.intentionalClose || ev.code === CLOSE_NORMAL) {
			this.setStatus("closed");
			return;
		}
		if (ev.code === CLOSE_SESSION_TAKEN) {
			this.emitError("sessionTaken");
			this.setStatus("closed");
			return;
		}
		// a protocol close before welcome is a rejected hello. the page swaps in
		// a fresh random profile on profileRejected, so retry through the normal
		// reconnect path — bounded and silent, and terminal once welcomed or
		// exhausted (only then is the rejection worth surfacing).
		if (ev.code === CLOSE_PROTOCOL) {
			if (this.hasEverConnected || this.helloRejects >= MAX_HELLO_REJECTS) {
				this.emitError("rejected");
				this.setStatus("closed");
				return;
			}
			this.helloRejects++;
			this.scheduleReconnect();
			return;
		}
		// re-emitted on every failed attempt on purpose: the tab-sync relay
		// broadcasts each emission, so follower tabs opened mid-outage still
		// learn the reason within one backoff cycle.
		this.emitError(ev.code === CLOSE_SERVER_FULL ? "serverFull" : "unreachable");
		this.scheduleReconnect();
	}

	private emitError(kind: ConnectionError["kind"]): void {
		const message = this.rejectMessage;
		this.events.onConnectionError?.(message ? {kind, message} : {kind});
	}

	private scheduleReconnect(): void {
		const delay = retryDelayMs(this.reconnectAttempt);
		this.reconnectAttempt++;
		this.setStatus(this.hasEverConnected ? "resuming" : "connecting");
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.openSocket();
		}, delay);
	}

	private setStatus(next: ConnectionStatus): void {
		if (this.status === next) return;
		this.status = next;
		this.events.onStatus?.(next);
	}
}
