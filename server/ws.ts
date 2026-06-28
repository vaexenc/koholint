import {NEUTRAL_INPUT} from "@/game/types";
import {
	type ChatMessage,
	type ClientMessage,
	type ConnId,
	type Profile,
	type ServerMessage,
} from "@/protocol";
import {paletteAccent} from "@/sprites/paletteAccent";
import {randomUUID, timingSafeEqual} from "node:crypto";
import type {IncomingMessage, Server} from "node:http";
import type {Duplex} from "node:stream";
import {WebSocketServer, type WebSocket} from "ws";
import {log} from "./log";
import {censorProfanity, checkName} from "./profanity";
import type {ResumeStore} from "./resume";
import {Room, type RoomListener, type Session} from "./rooms";

const HELLO_TIMEOUT_MS = 5000;
const CHAT_MAX_PER_SECOND = 3;
const CHAT_MAX_CHARS = 500;
const PING_INTERVAL_MS = 15_000;
const PONG_TIMEOUT_MS = 30_000;

// close codes carried in the ws CloseEvent — see HANDOFF.md.
const CLOSE_NORMAL = 1000;
const CLOSE_PROTOCOL = 1008;
export const CLOSE_SHUTDOWN = 4001;
const CLOSE_SESSION_TAKEN = 4002;

type Pending = {
	socket: WebSocket;
	helloTimer: NodeJS.Timeout;
};

type Connection = {
	socket: WebSocket;
	connId: ConnId;
	session: Session;
	chatTimestamps: number[];
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
	private readonly pingTimer: NodeJS.Timeout;

	constructor(opts: WsServerOpts) {
		this.room = opts.room;
		this.resume = opts.resume;
		this.adminToken = opts.adminToken;
		this.wss = new WebSocketServer({noServer: true});
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
		this.wss.handleUpgrade(req, socket, head, (ws) => {
			this.wss.emit("connection", ws, req);
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
		const msg = safeParseJson(raw);
		if (!msg || msg.type !== "hello") {
			log.warn("ws: non-hello first frame, closing");
			entry.socket.close(CLOSE_PROTOCOL, "hello first");
			return;
		}
		clearTimeout(entry.helloTimer);
		this.pending.delete(entry);
		this.handleHello(entry.socket, msg);
	}

	private handleHello(socket: WebSocket, msg: ClientMessage): void {
		if (msg.type !== "hello") return;
		const isAdmin = this.isAdminToken(msg.adminToken);
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
			const msg = safeParseJson(data.toString());
			if (!msg) return;
			this.dispatch(conn, msg);
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
				this.room.queueInputs(conn.connId, msg.ackTick, msg.inputs);
				return;
			case "teleport":
				this.onTeleport(conn, msg.x, msg.y);
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
			color: paletteAccent(conn.session.profile.paletteId),
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

	private dropConnection(conn: Connection, why: string, action: "leave" | "reconnect"): void {
		if (!this.byConnId.has(conn.connId)) return;
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
			color: paletteAccent(session.profile.paletteId),
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

	private isAdminToken(token: string | undefined): boolean {
		if (!this.adminToken || !token) return false;
		const expected = Buffer.from(this.adminToken);
		const got = Buffer.from(token);
		if (expected.length !== got.length) return false;
		return timingSafeEqual(expected, got);
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

function safeParseJson(raw: string): ClientMessage | null {
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object" && typeof parsed.type === "string") return parsed;
		return null;
	} catch {
		return null;
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
