import {
	CHAT_MAX_LENGTH,
	CLOSE_NORMAL,
	CLOSE_PROTOCOL,
	CLOSE_SERVER_FULL,
	CLOSE_SESSION_TAKEN,
	CLOSE_SHUTDOWN,
	type ChatMessage,
	type ChatSender,
	type ClientHello,
	type ClientMessage,
	type CoalescedInput,
	type ConnId,
	type Profile,
	type ServerMessage,
} from "@/shared/protocol";
import {randomUUID} from "node:crypto";
import type {IncomingMessage, Server} from "node:http";
import type {Duplex} from "node:stream";
import {WebSocketServer, type WebSocket} from "ws";
import {envInt} from "../env";
import {log} from "../log";
import {Room, sessionSnapshot, type RoomListener, type Session} from "../rooms";
import type {ResumeStore, SlotPose} from "../store/resume";
import {matchesAdminToken} from "./adminAuth";
import {resolveClientIp} from "./clientIp";
import {parseClientMessage} from "./parseClientMessage";
import {censorProfanity, checkName} from "./profanity";
import {Quota} from "./rateLimit";

const HELLO_TIMEOUT_MS = 5000;
// the window every per-connection message budget below is measured over.
const RATE_WINDOW_MS = 1000;
const CHAT_MAX_PER_SECOND = 3;
// inputs flush once per simulation tick (30Hz), not per render frame; sized
// with headroom for catch-up bursts after a tab stall and a brief overlap
// during a tab-control handoff. batches are redundant (each carries all
// unacked inputs) so a dropped flush loses nothing — this only caps a flood.
const INPUT_MAX_PER_SECOND = 60;
// view reports change on zoom/resize only and the client already self-throttles
// to ~4/s (VIEW_REPORT_MIN_INTERVAL_MS), so a legit client never reaches this
// cap and its widening reports are never dropped. this bounds a flood only; a
// client that floods past the cap can pin its *own* interest area stale (small
// or large) for up to a second — it harms nobody else, and the next accepted
// report corrects it.
const VIEW_MAX_PER_SECOND = 10;
const PING_INTERVAL_MS = 15_000;
const PONG_TIMEOUT_MS = 30_000;
// a session's pose otherwise reaches sqlite only when it ends, so an unclean
// exit — SIGKILL, OOM, power loss — would resume every connected player at
// wherever they stood when they *connected*, discarding the whole session's
// movement. this checkpoint bounds that loss to one interval. it also keeps
// lastSeenMs current, so the resume sweep can't expire a slot out from under a
// player who has been connected longer than RESUME_TTL_MS.
const POSE_PERSIST_INTERVAL_MS = 30_000;

// largest control frame we accept before parse. sized to the biggest legitimate
// client message — a maxed, redundant input batch (~MAX_INPUTS_PER_MESSAGE
// coalesced entries ≈ 70 KiB) — with headroom; anything larger is closed by ws
// (code 1009) rather than buffered. keeps 100 MiB frames off the parse path.
const WS_MAX_PAYLOAD_BYTES = 128 * 1024;
// concurrency backstops enforced at the upgrade, before a socket is tracked.
// mainly relevant once HOST is widened past loopback; tune per deployment.
// the total default is sized to the room's O(sessions²) snapshot fan-out —
// raising it much past 256 needs that pair loop bucketed (spatial grid) first.
const MAX_TOTAL_CONNECTIONS = envInt("MAX_TOTAL_CONNECTIONS", 256);
const MAX_CONNECTIONS_PER_IP = envInt("MAX_CONNECTIONS_PER_IP", 24);
// an over-cap reject completes the handshake just to deliver a readable close
// frame; terminate after this grace in case the peer never acks the close.
const REJECT_CLOSE_GRACE_MS = 2000;

// a socket's whole lifecycle, from the upgrade to the close. `conn` is the state
// machine: null while the hello is still outstanding, the live connection once
// it has been accepted. the socket's listeners are bound once, at connection, and
// dispatch on it — nothing is rebound mid-life.
type Pending = {
	socket: WebSocket;
	helloTimer: NodeJS.Timeout;
	conn: Connection | null;
};

type Connection = {
	socket: WebSocket;
	connId: ConnId;
	session: Session;
	// per-second budgets for the three client-driven message kinds.
	quotas: Readonly<Record<"chat" | "input" | "view", Quota>>;
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
	private readonly poseTimer: NodeJS.Timeout;

	constructor(opts: WsServerOpts) {
		this.room = opts.room;
		this.resume = opts.resume;
		this.adminToken = opts.adminToken;
		this.wss = new WebSocketServer({noServer: true, maxPayload: WS_MAX_PAYLOAD_BYTES});
		opts.httpServer.on("upgrade", (req, socket, head) => this.onUpgrade(req, socket, head));
		this.wss.on("connection", (socket) => this.onConnection(socket));
		this.room.addListener(this.makeListener());
		this.pingTimer = setInterval(() => this.heartbeat(), PING_INTERVAL_MS);
		this.poseTimer = setInterval(() => this.persistPoses(), POSE_PERSIST_INTERVAL_MS);
	}

	shutdown(reason: string): void {
		clearInterval(this.pingTimer);
		// the closes below run dropConnection for every live session, which writes
		// each final pose — a checkpoint firing in between would only repeat work.
		clearInterval(this.poseTimer);
		const goodbye: ServerMessage = {type: "chat", message: systemMessage(reason)};
		for (const conn of this.byConnId.values()) {
			safeSendJson(conn.socket, goodbye);
			closeQuietly(conn.socket, CLOSE_SHUTDOWN, "server shutdown");
		}
		for (const p of this.pending) {
			clearTimeout(p.helloTimer);
			closeQuietly(p.socket, CLOSE_SHUTDOWN, "server shutdown");
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
			closeQuietly(socket, CLOSE_PROTOCOL, "hello first");
		}, HELLO_TIMEOUT_MS);
		const entry: Pending = {socket, helloTimer, conn: null};
		this.pending.add(entry);
		socket.on("message", (data, isBinary) => {
			const conn = entry.conn;
			if (!conn) {
				if (isBinary) {
					log.warn("ws: pre-hello binary frame, closing");
					socket.close(CLOSE_PROTOCOL, "hello first");
					return;
				}
				this.onPendingMessage(entry, data.toString());
				return;
			}
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
		socket.on("close", () => {
			clearTimeout(helloTimer);
			this.pending.delete(entry);
			if (entry.conn) this.dropConnection(entry.conn, "client close", "leave");
		});
		socket.on("error", (err) => log.warn(`ws: ${entry.conn?.connId ?? "pending"} error:`, err));
		socket.on("pong", () => {
			if (entry.conn) entry.conn.lastPongAt = Date.now();
		});
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
			this.handleHello(entry, msg);
		} catch (err) {
			log.error("ws: hello handler error:", err);
			closeQuietly(entry.socket, CLOSE_PROTOCOL, "internal error");
		}
	}

	private handleHello(entry: Pending, msg: ClientHello): void {
		const {socket} = entry;
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
				closeQuietly(live.socket, CLOSE_SESSION_TAKEN, "session_taken");
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
			...profile,
			x: session.character.x,
			y: session.character.y,
			facing: session.character.facing,
			lastSeenMs: Date.now(),
		});
		const conn: Connection = {
			socket,
			connId: session.connId,
			session,
			quotas: {
				chat: new Quota(CHAT_MAX_PER_SECOND, RATE_WINDOW_MS),
				input: new Quota(INPUT_MAX_PER_SECOND, RATE_WINDOW_MS),
				view: new Quota(VIEW_MAX_PER_SECOND, RATE_WINDOW_MS),
			},
			lastPongAt: Date.now(),
		};
		this.byConnId.set(session.connId, conn);
		// flips the socket's listeners from the pre-hello path to the live one.
		entry.conn = conn;
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
		this.room.announce(this.makePresence(session, action));
		// always announce the entity, including on reconnect: peers removed this
		// player's remote when the previous socket dropped (a `leave` broadcast),
		// so without a fresh `join` nobody re-creates it and the reconnector stays
		// invisible to everyone but themselves. addRemote is idempotent, so a peer
		// that somehow still has the remote ignores the duplicate.
		this.room.broadcast({type: "join", player: sessionSnapshot(session)});
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
				closeQuietly(conn.socket, CLOSE_NORMAL, "leave");
				return;
		}
	}

	private onSetProfile(conn: Connection, profile: Profile): void {
		const isAdmin = conn.session.isAdmin;
		const check = checkName(profile.name, isAdmin);
		if (!check.ok) {
			this.room.send(conn.connId, {type: "profileRejected", reason: check.reason});
			return;
		}
		const next: Profile = {
			name: check.name,
			avatarId: profile.avatarId,
			paletteId: profile.paletteId,
		};
		const result = this.room.applyProfile(conn.connId, next);
		if (!result.ok) {
			this.room.send(conn.connId, {type: "profileRejected", reason: result.reason});
			return;
		}
		this.resume.touch(conn.session.resumeToken, next);
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
		if (!conn.quotas.input.tryTake()) return;
		this.room.queueInputs(conn.connId, ackTick, inputs);
	}

	private onChat(conn: Connection, rawText: string): void {
		const text = rawText.slice(0, CHAT_MAX_LENGTH).trim();
		if (!text) return;
		if (!conn.quotas.chat.tryTake()) return;
		const filtered = censorProfanity(text);
		this.room.announce({
			id: randomUUID(),
			kind: "chat",
			...senderIdentity(conn.session),
			text: filtered,
			// only ship the original when it differs, so clients can offer a
			// "show obscenities" toggle without a second round-trip.
			...(filtered === text ? {} : {rawText: text}),
			timestamp: Date.now(),
		});
	}

	// admin-gated, but the gate is the room's: it owns the session and so the
	// answer to who may move one. re-checking here would be a second copy of that
	// rule for the two to eventually disagree about.
	private onTeleport(conn: Connection, x: number, y: number): void {
		this.room.teleport(conn.connId, x, y);
	}

	private onView(conn: Connection, w: number, h: number): void {
		if (!conn.quotas.view.tryTake()) return;
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
			this.resume.touch(session.resumeToken, slotPose(session));
			if (action === "leave") this.room.announce(this.makePresence(session, "leave"));
			this.room.broadcast({type: "leave", connId: conn.connId});
		}
		log.info(`ws: dropped ${conn.connId} (${why})`);
	}

	private makePresence(session: Session, action: "join" | "leave" | "reconnect"): ChatMessage {
		return {
			id: randomUUID(),
			kind: "presence",
			action,
			...senderIdentity(session),
			timestamp: Date.now(),
		};
	}

	private persistPoses(): void {
		this.resume.touchMany(
			[...this.byConnId.values()].map((conn) => ({
				token: conn.session.resumeToken,
				patch: slotPose(conn.session),
			}))
		);
	}

	private heartbeat(): void {
		const now = Date.now();
		for (const conn of this.byConnId.values()) {
			if (now - conn.lastPongAt > PONG_TIMEOUT_MS) {
				quietly(() => conn.socket.terminate());
				continue;
			}
			quietly(() => conn.socket.ping());
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
				quietly(() => conn.socket.send(buf, {binary: true}));
			},
		};
	}
}

function systemMessage(text: string): ChatMessage {
	return {id: randomUUID(), kind: "system", text, timestamp: Date.now()};
}

// the one projection from a live session onto its stored pose, so the periodic
// checkpoint and the disconnect write can't drift on what gets persisted.
function slotPose(session: Session): SlotPose {
	return {
		x: session.character.x,
		y: session.character.y,
		facing: session.character.facing,
	};
}

// the one projection from a live session onto the wire's sender shape, so the
// chat and presence lines a session produces can't describe it differently.
function senderIdentity(session: Session): ChatSender {
	return {
		senderId: session.connId,
		name: session.profile.name,
		color: session.color,
		avatarId: session.profile.avatarId,
		paletteId: session.profile.paletteId,
	};
}

function clientIp(req: IncomingMessage): string {
	// the frontend server proxies the upgrade, so the peer is that proxy for
	// every player; resolveClientIp reads the forwarded address instead, and
	// only when the peer is one we trust.
	return resolveClientIp(req.socket.remoteAddress, req.headers["x-forwarded-for"]);
}

// every socket operation here races the peer disconnecting, and a throw from one
// must never abort the loop or handler around it. this is the one place that
// swallow lives, so no call site grows its own try/catch.
function quietly(action: () => void): void {
	try {
		action();
	} catch {
		// socket already gone.
	}
}

function closeQuietly(socket: WebSocket, code: number, reason: string): void {
	quietly(() => socket.close(code, reason));
}

function safeSendJson(socket: WebSocket, msg: ServerMessage): void {
	safeSendRaw(socket, JSON.stringify(msg));
}

function safeSendRaw(socket: WebSocket, data: string): void {
	quietly(() => socket.send(data));
}
