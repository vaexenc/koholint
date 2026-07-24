import {NEUTRAL_INPUT} from "@/game/types";
import {
	CLOSE_NORMAL,
	CLOSE_PROTOCOL,
	CLOSE_SERVER_FULL,
	CLOSE_SESSION_TAKEN,
	CLOSE_SHUTDOWN,
	type ChatMessage,
	type ClientMessage,
	type CoalescedInput,
	type ConnId,
	type Profile,
	type ServerMessage,
} from "@/protocol";
import {randomUUID} from "node:crypto";
import type {IncomingMessage, Server} from "node:http";
import type {Duplex} from "node:stream";
import {WebSocketServer, type WebSocket} from "ws";
import {matchesAdminToken} from "./adminAuth";
import {envInt} from "./env";
import {log} from "./log";
import {parseClientMessage} from "./parseMessage";
import {censorProfanity, checkName} from "./profanity";
import type {ResumeStore} from "./resume";
import {Room, type RoomListener, type Session} from "./rooms";

const HELLO_TIMEOUT_MS = 5000;
const CHAT_MAX_PER_SECOND = 3;
const CHAT_MAX_CHARS = 500;
// inputs flush once per client render frame, so high-refresh displays legitimately
// exceed the 30Hz tick rate; sized above 240Hz. batches are redundant (each carries
// all unacked inputs) so a dropped flush loses nothing — this only caps a flood.
const INPUT_MAX_PER_SECOND = 250;
// view reports change on zoom/resize only and the client already self-throttles
// to ~4/s (VIEW_REPORT_MIN_INTERVAL_MS), so a legit client never reaches this
// cap and its widening reports are never dropped. this bounds a flood only; a
// client that floods past the cap can pin its *own* interest area stale (small
// or large) for up to a second — it harms nobody else, and the next accepted
// report corrects it.
const VIEW_MAX_PER_SECOND = 10;
const PING_INTERVAL_MS = 15_000;
const PONG_TIMEOUT_MS = 30_000;

// largest control frame we accept before parse. sized to the biggest legitimate
// client message — a maxed, redundant input batch (~MAX_INPUTS_PER_MESSAGE
// coalesced entries ≈ 70 KiB) — with headroom; anything larger is closed by ws
// (code 1009) rather than buffered. keeps 100 MiB frames off the parse path.
const WS_MAX_PAYLOAD_BYTES = 128 * 1024;
// concurrency backstops enforced at the upgrade, before a socket is tracked.
// mainly relevant once HOST is widened past loopback; tune per deployment.
const MAX_TOTAL_CONNECTIONS = envInt("MAX_TOTAL_CONNECTIONS", 1024);
const MAX_CONNECTIONS_PER_IP = envInt("MAX_CONNECTIONS_PER_IP", 1024);
// an over-cap reject completes the handshake just to deliver a readable close
// frame; terminate after this grace in case the peer never acks the close.
const REJECT_CLOSE_GRACE_MS = 2000;

type Pending = {
	socket: WebSocket;
	helloTimer: NodeJS.Timeout;
};

type Connection = {
	socket: WebSocket;
	connId: ConnId;
	session: Session;
	chatTimestamps: number[];
	inputTimestamps: number[];
	viewTimestamps: number[];
	lastPongAt: number;
};

type WsServerOpts = {
	readonly httpServer: Server;
	readonly room: Room;
	readonly resume: ResumeStore;
	readonly adminToken: string | null;
};

// glue between the ws library and the Room. owns the upgrade hookup, the
// per-connection lifecycle (hello timeout, dispatch, heartbeat, close) and
// the RoomListener that lets the room push outbound frames.
export class WsServer {
	private readonly wss: WebSocketServer;
	private readonly room: Room;
	private readonly resume: ResumeStore;
	private readonly adminToken: string | null;
	private readonly pending = new Set<Pending>();
	private readonly byConnId = new Map<ConnId, Connection>();
	private readonly connectionsByIp = new Map<string, number>();
	private totalConnections = 0;
	private readonly pingTimer: NodeJS.Timeout;

	constructor(opts: WsServerOpts) {
		this.room = opts.room;
		this.resume = opts.resume;
		this.adminToken = opts.adminToken;
		this.wss = new WebSocketServer({noServer: true, maxPayload: WS_MAX_PAYLOAD_BYTES});
		opts.httpServer.on("upgrade", (req, socket, head) => this.onUpgrade(req, socket, head));
		this.wss.on("connection", (socket) => this.onConnection(socket));
		this.room.addListener(this.makeListener());
		this.pingTimer = setInterval(() => this.heartbeat(), PING_INTERVAL_MS);
	}

	shutdown(reason: string): void {
		clearInterval(this.pingTimer);
		const goodbye: ServerMessage = {
			type: "system",
			message: systemMessage(reason),
		};
		for (const conn of this.byConnId.values()) {
			safeSendJson(conn.socket, goodbye);
			try {
				conn.socket.close(CLOSE_SHUTDOWN, "server shutdown");
			} catch {
				// noop
			}
		}
		for (const p of this.pending) {
			clearTimeout(p.helloTimer);
			try {
				p.socket.close(CLOSE_SHUTDOWN, "server shutdown");
			} catch {
				// noop
			}
		}
	}

	private onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
		const url = req.url ?? "";
		if (!url.startsWith("/ws")) {
			socket.destroy();
			return;
		}
		const ip = clientIp(req);
		const overTotal = this.totalConnections >= MAX_TOTAL_CONNECTIONS;
		const overIp = (this.connectionsByIp.get(ip) ?? 0) >= MAX_CONNECTIONS_PER_IP;
		if (overTotal || overIp) {
			log.warn(`ws: connection cap reached, rejecting ${ip}`);
			// a raw destroy() reaches the browser as an anonymous 1006, which the
			// client can't tell apart from "server down". finish the handshake,
			// say why in a pre-close frame the loading screen shows verbatim, and
			// close properly. the reject never emits "connection", so it takes no
			// hello timer or slot.
			this.wss.handleUpgrade(req, socket, head, (ws) => {
				safeSendJson(ws, {
					type: "connectionRejected",
					message: overTotal
						? "Server is full"
						: "Too many connections from your address",
				});
				ws.close(CLOSE_SERVER_FULL, "server full");
				setTimeout(() => ws.terminate(), REJECT_CLOSE_GRACE_MS).unref();
			});
			return;
		}
		this.trackConnection(ip, socket);
		this.wss.handleUpgrade(req, socket, head, (ws) => {
			this.wss.emit("connection", ws, req);
		});
	}

	// count every accepted upgrade against the global + per-IP caps and release
	// the slot when the underlying socket closes — whether the handshake fails,
	// the connection is dropped pre-hello, or a live session leaves. tracking the
	// raw socket (which the ws instance keeps using) covers all three.
	private trackConnection(ip: string, socket: Duplex): void {
		this.totalConnections++;
		this.connectionsByIp.set(ip, (this.connectionsByIp.get(ip) ?? 0) + 1);
		let released = false;
		socket.once("close", () => {
			if (released) return;
			released = true;
			this.totalConnections--;
			const remaining = (this.connectionsByIp.get(ip) ?? 1) - 1;
			if (remaining <= 0) this.connectionsByIp.delete(ip);
			else this.connectionsByIp.set(ip, remaining);
		});
	}

	private onConnection(socket: WebSocket): void {
		const helloTimer = setTimeout(() => {
			log.warn("ws: hello timeout, closing");
			try {
				socket.close(CLOSE_PROTOCOL, "hello first");
			} catch {
				// noop
			}
		}, HELLO_TIMEOUT_MS);
		const entry: Pending = {socket, helloTimer};
		this.pending.add(entry);
		socket.on("message", (data, isBinary) => {
			if (isBinary) {
				log.warn("ws: pre-hello binary frame, closing");
				socket.close(CLOSE_PROTOCOL, "hello first");
				return;
			}
			this.onPendingMessage(entry, data.toString());
		});
		socket.on("close", () => {
			clearTimeout(helloTimer);
			this.pending.delete(entry);
		});
		socket.on("error", (err) => log.warn("ws: pending error:", err));
	}

	private onPendingMessage(entry: Pending, raw: string): void {
		const msg = parseClientMessage(raw);
		if (!msg || msg.type !== "hello") {
			log.warn("ws: non-hello first frame, closing");
			entry.socket.close(CLOSE_PROTOCOL, "hello first");
			return;
		}
		clearTimeout(entry.helloTimer);
		this.pending.delete(entry);
		try {
			this.handleHello(entry.socket, msg);
		} catch (err) {
			log.error("ws: hello handler error:", err);
			closeQuietly(entry.socket, CLOSE_PROTOCOL, "internal error");
		}
	}

	private handleHello(socket: WebSocket, msg: ClientMessage): void {
		if (msg.type !== "hello") return;
		const isAdmin = matchesAdminToken(this.adminToken, msg.adminToken);
		const nameCheck = checkName(msg.name, isAdmin);
		if (!nameCheck.ok) {
			safeSendJson(socket, {type: "profileRejected", reason: nameCheck.reason});
			socket.close(CLOSE_PROTOCOL, "invalid name");
			return;
		}
		const profile: Profile = {
			name: nameCheck.name,
			avatarId: msg.avatarId,
			paletteId: msg.paletteId,
		};
		const existing = msg.resumeToken ? this.resume.get(msg.resumeToken) : undefined;
		let session: Session;
		let resumeToken: string;
		if (existing) {
			const live = this.byConnId.get(existing.connId);
			if (live) {
				log.info(`ws: session_taken for ${existing.connId}`);
				try {
					live.socket.close(CLOSE_SESSION_TAKEN, "session_taken");
				} catch {
					// noop
				}
				this.dropConnection(live, "session_taken", "reconnect");
			}
			resumeToken = existing.resumeToken;
			session = this.room.addSession({
				connId: existing.connId,
				profile,
				isAdmin,
				resumeToken,
				idIndex: existing.idIndex,
				pose: {x: existing.x, y: existing.y, facing: existing.facing},
			});
		} else {
			const connId = randomUUID();
			resumeToken = randomUUID();
			session = this.room.addSession({connId, profile, isAdmin, resumeToken});
		}
		this.resume.upsert({
			resumeToken,
			connId: session.connId,
			idIndex: session.idIndex,
			profile,
			x: session.character.x,
			y: session.character.y,
			facing: session.character.facing,
			lastSeenMs: Date.now(),
		});
		const conn: Connection = {
			socket,
			connId: session.connId,
			session,
			chatTimestamps: [],
			inputTimestamps: [],
			viewTimestamps: [],
			lastPongAt: Date.now(),
		};
		this.byConnId.set(session.connId, conn);
		this.attachLiveHandlers(conn);
		safeSendJson(socket, {
			type: "welcome",
			connId: session.connId,
			isAdmin,
			serverTick: this.room.getTick(),
			serverTimeMs: Date.now(),
			resumeToken,
			spawn: {x: session.character.x, y: session.character.y},
			players: this.room.snapshotPlayers(),
			chatBacklog: this.room.getChatBacklog(),
		});
		const action: "join" | "reconnect" = existing ? "reconnect" : "join";
		const presence = this.makePresence(session, action);
		this.room.pushChat(presence);
		this.room.broadcast({type: "presence", message: presence});
		// always announce the entity, including on reconnect: peers removed this
		// player's remote when the previous socket dropped (a `leave` broadcast),
		// so without a fresh `join` nobody re-creates it and the reconnector stays
		// invisible to everyone but themselves. addRemote is idempotent, so a peer
		// that somehow still has the remote ignores the duplicate.
		this.room.broadcast({
			type: "join",
			player: {
				connId: session.connId,
				idIndex: session.idIndex,
				profile: session.profile,
				color: session.color,
				x: session.character.x,
				y: session.character.y,
				facing: session.character.facing,
			},
		});
	}

	private attachLiveHandlers(conn: Connection): void {
		conn.socket.removeAllListeners("message");
		conn.socket.on("message", (data, isBinary) => {
			if (isBinary) return;
			const msg = parseClientMessage(data.toString());
			if (!msg) return;
			try {
				this.dispatch(conn, msg);
			} catch (err) {
				log.error(`ws: dispatch error for ${conn.connId}:`, err);
				closeQuietly(conn.socket, CLOSE_PROTOCOL, "internal error");
			}
		});
		conn.socket.on("close", () => this.dropConnection(conn, "client close", "leave"));
		conn.socket.on("error", (err) => log.warn(`ws: conn ${conn.connId} error:`, err));
		conn.socket.on("pong", () => {
			conn.lastPongAt = Date.now();
		});
	}

	private dispatch(conn: Connection, msg: ClientMessage): void {
		switch (msg.type) {
			case "hello":
				return;
			case "setProfile":
				return this.onSetProfile(conn, msg.profile);
			case "chat":
				return this.onChat(conn, msg.text);
			case "input":
				this.onInput(conn, msg.ackTick, msg.inputs);
				return;
			case "teleport":
				this.onTeleport(conn, msg.x, msg.y);
				return;
			case "view":
				this.onView(conn, msg.w, msg.h);
				return;
			case "leave":
				try {
					conn.socket.close(CLOSE_NORMAL, "leave");
				} catch {
					// noop
				}
				return;
		}
	}

	private onSetProfile(conn: Connection, profile: Profile): void {
		const isAdmin = conn.session.isAdmin;
		const check = checkName(profile.name, isAdmin);
		if (!check.ok) {
			this.send(conn.connId, {type: "profileRejected", reason: check.reason});
			return;
		}
		const next: Profile = {
			name: check.name,
			avatarId: profile.avatarId,
			paletteId: profile.paletteId,
		};
		const result = this.room.applyProfile(conn.connId, next);
		if (!result.ok) {
			this.send(conn.connId, {type: "profileRejected", reason: result.reason});
			return;
		}
		this.resume.touch(conn.session.resumeToken, {profile: next});
		this.room.broadcast({
			type: "profileChanged",
			connId: conn.connId,
			profile: next,
			color: result.color,
		});
	}

	private onInput(
		conn: Connection,
		ackTick: number,
		inputs: ReadonlyArray<CoalescedInput>
	): void {
		const now = Date.now();
		conn.inputTimestamps = conn.inputTimestamps.filter((t) => now - t < 1000);
		if (conn.inputTimestamps.length >= INPUT_MAX_PER_SECOND) return;
		conn.inputTimestamps.push(now);
		this.room.queueInputs(conn.connId, ackTick, inputs);
	}

	private onChat(conn: Connection, rawText: string): void {
		const now = Date.now();
		conn.chatTimestamps = conn.chatTimestamps.filter((t) => now - t < 1000);
		if (conn.chatTimestamps.length >= CHAT_MAX_PER_SECOND) return;
		const text = rawText.slice(0, CHAT_MAX_CHARS).trim();
		if (!text) return;
		conn.chatTimestamps.push(now);
		const filtered = censorProfanity(text);
		const message: ChatMessage = {
			id: randomUUID(),
			kind: "chat",
			senderId: conn.connId,
			name: conn.session.profile.name,
			color: conn.session.color,
			avatarId: conn.session.profile.avatarId,
			paletteId: conn.session.profile.paletteId,
			text: filtered,
			// only ship the original when it differs, so clients can offer a
			// "show obscenities" toggle without a second round-trip.
			...(filtered === text ? {} : {rawText: text}),
			timestamp: now,
		};
		this.room.pushChat(message);
		this.room.broadcast({type: "chat", message});
	}

	private onTeleport(conn: Connection, x: number, y: number): void {
		if (!conn.session.isAdmin) return;
		this.room.teleport(conn.connId, x, y);
	}

	private onView(conn: Connection, w: number, h: number): void {
		const now = Date.now();
		conn.viewTimestamps = conn.viewTimestamps.filter((t) => now - t < 1000);
		if (conn.viewTimestamps.length >= VIEW_MAX_PER_SECOND) return;
		conn.viewTimestamps.push(now);
		this.room.setView(conn.connId, w, h);
	}

	private dropConnection(conn: Connection, why: string, action: "leave" | "reconnect"): void {
		// identity, not just presence: a session_taken reconnect drops the old
		// conn and registers the successor under the same connId synchronously,
		// so the old socket's later close event re-enters here — matching only by
		// connId would then delete the successor's live entry and tear down its
		// session. bail unless this is still the registered conn.
		if (this.byConnId.get(conn.connId) !== conn) return;
		this.byConnId.delete(conn.connId);
		const session = this.room.removeSession(conn.connId);
		if (session) {
			this.resume.touch(session.resumeToken, {
				x: session.character.x,
				y: session.character.y,
				facing: session.character.facing,
			});
			if (action === "leave") {
				const presence = this.makePresence(session, "leave");
				this.room.pushChat(presence);
				this.room.broadcast({type: "presence", message: presence});
			}
			this.room.broadcast({type: "leave", connId: conn.connId});
		}
		conn.session.inputProvider.setInput(NEUTRAL_INPUT);
		log.info(`ws: dropped ${conn.connId} (${why})`);
	}

	private makePresence(session: Session, action: "join" | "leave" | "reconnect"): ChatMessage {
		return {
			id: randomUUID(),
			kind: "presence",
			action,
			senderId: session.connId,
			name: session.profile.name,
			color: session.color,
			avatarId: session.profile.avatarId,
			paletteId: session.profile.paletteId,
			timestamp: Date.now(),
		};
	}

	private heartbeat(): void {
		const now = Date.now();
		for (const conn of this.byConnId.values()) {
			if (now - conn.lastPongAt > PONG_TIMEOUT_MS) {
				try {
					conn.socket.terminate();
				} catch {
					// noop
				}
				continue;
			}
			try {
				conn.socket.ping();
			} catch {
				// noop
			}
		}
	}

	private makeListener(): RoomListener {
		return {
			broadcastJson: (msg) => {
				const data = JSON.stringify(msg);
				for (const conn of this.byConnId.values()) safeSendRaw(conn.socket, data);
			},
			sendJson: (connId, msg) => {
				const conn = this.byConnId.get(connId);
				if (!conn) return;
				safeSendRaw(conn.socket, JSON.stringify(msg));
			},
			sendBinary: (connId, buf) => {
				const conn = this.byConnId.get(connId);
				if (!conn) return;
				try {
					conn.socket.send(buf, {binary: true});
				} catch {
					// noop
				}
			},
		};
	}

	private send(connId: ConnId, msg: ServerMessage): void {
		this.room.send(connId, msg);
	}
}

function systemMessage(text: string): ChatMessage {
	return {id: randomUUID(), kind: "system", text, timestamp: Date.now()};
}

function clientIp(req: IncomingMessage): string {
	// direct peer address only — X-Forwarded-For is attacker-spoofable and there
	// is no trusted proxy in this deployment, so honoring it would defeat the cap.
	return req.socket.remoteAddress ?? "unknown";
}

function closeQuietly(socket: WebSocket, code: number, reason: string): void {
	try {
		socket.close(code, reason);
	} catch {
		// noop
	}
}

function safeSendJson(socket: WebSocket, msg: ServerMessage): void {
	safeSendRaw(socket, JSON.stringify(msg));
}

function safeSendRaw(socket: WebSocket, data: string): void {
	try {
		socket.send(data);
	} catch {
		// noop
	}
}
