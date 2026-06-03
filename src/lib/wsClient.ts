import {stepCharacter, type BasicCharacter} from "@/game/character";
import {NEUTRAL_INPUT, type CharacterInput, type Direction} from "@/game/types";
import type {World} from "@/game/world";
import {
	decodeSnapshot,
	type ChatMessage,
	type ClientMessage,
	type CoalescedInput,
	type ConnId,
	type DecodedSnapshot,
	type PlayerSnapshot,
	type Profile,
	type ServerMessage,
	type ServerProfileChanged,
	type ServerProfileRejected,
	type ServerWelcome,
} from "@/protocol";

export type ConnectionStatus = "idle" | "connecting" | "resuming" | "connected" | "closed";

export const RESUME_TOKEN_KEY = "koholint:resumeToken";

// 1->2->4->8s cap per HANDOFF reconnect spec. last entry repeats forever.
const RECONNECT_BACKOFFS_MS = [1000, 2000, 4000, 8000];
// drop inputs older than ~30s so a long disconnect doesn't shower the server
// with stale frames on resume. matches MAX_INPUT_AGE_TICKS on the server.
const INPUT_MAX_AGE_TICKS = 30 * 30;

export type WsClientOpts = {
	readonly url: string;
	readonly getProfile: () => Profile;
	readonly getAdminToken?: () => string | undefined;
};

export type WsClientEvents = {
	onStatus?(status: ConnectionStatus): void;
	onWelcome?(msg: ServerWelcome): void;
	onChat?(msg: ChatMessage): void;
	onPresence?(msg: ChatMessage): void;
	onSystem?(msg: ChatMessage): void;
	onJoin?(player: PlayerSnapshot): void;
	onLeave?(connId: ConnId): void;
	onProfileChanged?(msg: ServerProfileChanged): void;
	onProfileRejected?(msg: ServerProfileRejected): void;
	onSnapshot?(snapshot: DecodedSnapshot): void;
};

// thin wire-layer wrapper around a single ws connection. owns reconnect with
// backoff, the hello handshake, the resume-token round-trip, the JSON outbox,
// and the local input buffer used by replayLocalInputs() for prediction.
// remains DOM-aware (WebSocket + localStorage) but DOM-render free; the page
// layer owns the World and feeds inputs in / snapshots out.
export class WsClient {
	private readonly opts: WsClientOpts;
	private events: WsClientEvents = {};
	private socket: WebSocket | null = null;
	private status: ConnectionStatus = "idle";
	private hasEverConnected = false;
	private reconnectAttempt = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private intentionalClose = false;
	private outbox: ClientMessage[] = [];
	private inputBuffer = new Map<number, CharacterInput>();
	private lastServerAck = 0;

	constructor(opts: WsClientOpts) {
		this.opts = opts;
	}

	setEvents(events: WsClientEvents): void {
		this.events = events;
	}

	getStatus(): ConnectionStatus {
		return this.status;
	}

	getLastServerAck(): number {
		return this.lastServerAck;
	}

	getRecordedInputs(): ReadonlyMap<number, CharacterInput> {
		return this.inputBuffer;
	}

	connect(): void {
		if (this.socket || this.reconnectTimer) return;
		this.intentionalClose = false;
		this.openSocket();
	}

	disconnect(reason = "client leave"): void {
		this.intentionalClose = true;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		const live = this.socket;
		if (live?.readyState === WebSocket.OPEN) this.sendNow({type: "leave"});
		this.socket = null;
		try {
			live?.close(1000, reason);
		} catch {
			// noop
		}
		this.setStatus("closed");
	}

	recordInput(tick: number, input: CharacterInput): void {
		this.inputBuffer.set(tick, input);
		const floor = tick - INPUT_MAX_AGE_TICKS;
		for (const t of this.inputBuffer.keys()) if (t < floor) this.inputBuffer.delete(t);
	}

	// sends every recorded input newer than the server's last ack and not
	// past the current local tick. redundancy (each batch carries all
	// unacked inputs) replaces retransmit logic.
	flushInputs(currentTick: number): void {
		if (this.status !== "connected" || this.inputBuffer.size === 0) return;
		const inputs: CoalescedInput[] = [];
		for (const [tick, input] of this.inputBuffer) {
			if (tick > this.lastServerAck && tick <= currentTick) inputs.push({tick, input});
		}
		if (inputs.length === 0) return;
		inputs.sort((a, b) => a.tick - b.tick);
		this.sendNow({type: "input", ackTick: this.lastServerAck, inputs});
	}

	sendChat(text: string): void {
		if (this.status !== "connected") return;
		this.sendNow({type: "chat", text});
	}

	sendSetProfile(profile: Profile): void {
		this.send({type: "setProfile", profile});
	}

	sendTeleport(x: number, y: number): void {
		if (this.status !== "connected") return;
		this.sendNow({type: "teleport", x, y});
	}

	private send(msg: ClientMessage): void {
		if (this.status === "connected" && this.socket?.readyState === WebSocket.OPEN) {
			this.sendNow(msg);
			return;
		}
		this.outbox.push(msg);
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
		const adminToken = this.opts.getAdminToken?.();
		const resumeToken = readResumeToken();
		const hello: ClientMessage = {
			type: "hello",
			name: profile.name,
			avatarId: profile.avatarId,
			paletteId: profile.paletteId,
			adminToken: adminToken || undefined,
			resumeToken: resumeToken || undefined,
		};
		this.sendNow(hello);
	}

	private onMessage(ev: MessageEvent): void {
		if (ev.data instanceof ArrayBuffer) {
			const snap = decodeSnapshot(ev.data);
			if (snap.ackTickForYou > this.lastServerAck) this.lastServerAck = snap.ackTickForYou;
			for (const t of this.inputBuffer.keys())
				if (t <= this.lastServerAck) this.inputBuffer.delete(t);
			this.events.onSnapshot?.(snap);
			return;
		}
		if (typeof ev.data !== "string") return;
		const msg = parseServerMessage(ev.data);
		if (msg) this.dispatch(msg);
	}

	private dispatch(msg: ServerMessage): void {
		switch (msg.type) {
			case "welcome":
				return this.onWelcome(msg);
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

	private onWelcome(msg: ServerWelcome): void {
		persistResumeToken(msg.resumeToken);
		this.hasEverConnected = true;
		this.reconnectAttempt = 0;
		this.lastServerAck = msg.serverTick;
		// pre-welcome inputs reference a tick frame that may no longer line
		// up with the server; drop them and let the page record fresh ones.
		this.inputBuffer.clear();
		this.setStatus("connected");
		this.events.onWelcome?.(msg);
		for (const queued of this.outbox.splice(0)) this.sendNow(queued);
	}

	private onClose(ev: CloseEvent): void {
		this.socket = null;
		if (this.intentionalClose || ev.code === 1000) {
			this.setStatus("closed");
			return;
		}
		this.scheduleReconnect();
	}

	private scheduleReconnect(): void {
		const idx = Math.min(this.reconnectAttempt, RECONNECT_BACKOFFS_MS.length - 1);
		const delay = RECONNECT_BACKOFFS_MS[idx];
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

function parseServerMessage(raw: string): ServerMessage | null {
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object" && typeof parsed.type === "string") return parsed;
		return null;
	} catch {
		return null;
	}
}

function readResumeToken(): string | null {
	try {
		return window.localStorage.getItem(RESUME_TOKEN_KEY);
	} catch {
		return null;
	}
}

function persistResumeToken(token: string): void {
	try {
		window.localStorage.setItem(RESUME_TOKEN_KEY, token);
	} catch {
		// storage may be unavailable; skip silently.
	}
}

// snaps the local self-character to the authoritative pose at `fromTick` and
// replays every recorded input from fromTick+1 to toTick through stepCharacter.
// the caller passes the recorded input table from WsClient.getRecordedInputs()
// so the buffer stays the single source of truth. cancels in-flight client-only
// animations (jump, teleport) because server pose is ground truth.
export function replayLocalInputs(
	world: World,
	character: BasicCharacter,
	authoritative: {x: number; y: number; facing: Direction; walking: boolean; animByte: number},
	fromTick: number,
	toTick: number,
	dtSec: number,
	inputs: ReadonlyMap<number, CharacterInput>
): void {
	character.x = authoritative.x;
	character.y = authoritative.y;
	character.prevX = authoritative.x;
	character.prevY = authoritative.y;
	character.facing = authoritative.facing;
	character.walking = authoritative.walking;
	// anchor the walk-cycle phase to the authoritative value before replaying,
	// exactly as we do for position. without this the replay re-accumulates
	// animTimeMs for ticks that forward-stepping already counted, so the phase
	// double-counts and the walk animation lurches every snapshot.
	character.animTimeMs = authoritative.animByte * 16;
	character.jump = null;
	character.teleport = null;
	character.jumpOffsetY = 0;
	character.prevJumpOffsetY = 0;
	for (let t = fromTick + 1; t <= toTick; t++) {
		const input = inputs.get(t) ?? NEUTRAL_INPUT;
		stepCharacter(
			character,
			input,
			dtSec,
			world.grid,
			world.terrain,
			world.holes,
			world.cliffs,
			world.teleporters
		);
	}
}
