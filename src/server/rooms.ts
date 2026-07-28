import {
	createBasicCharacter,
	resolveCharacterCollision,
	teleportToTile,
	type BasicCharacter,
} from "@/shared/game/character";
import {GameClock} from "@/shared/game/clock";
import {StaticInputProvider} from "@/shared/game/controllers";
import {buildWorldGrids} from "@/shared/game/grids";
import {sampleSpawn, type SpawnRegion} from "@/shared/game/spawn";
import {NEUTRAL_INPUT, type CharacterInput} from "@/shared/game/types";
import {World} from "@/shared/game/world";
import {clamp} from "@/shared/lib/math";
import {
	INTEREST_EXIT_MARGIN_PX,
	INTEREST_MARGIN_PX,
	MAX_INPUT_LOOKAHEAD_TICKS,
	MAX_INPUTS_PER_MESSAGE,
	MAX_VIEW_WORLD_PX,
	pushBacklog,
	SNAPSHOT_HZ,
	TICK_HZ,
	type ChatMessage,
	type CoalescedInput,
	type ConnId,
	type PlayerSnapshot,
	type Profile,
	type ServerMessage,
} from "@/shared/protocol";
import {encodeAnimByte, encodeSnapshot, type SnapshotPose} from "@/shared/protocol/snapshot";
import {profileAccent} from "@/shared/sprites/profileAccent";
import type {HexColor, SpriteAsset} from "@/shared/sprites/types";
import type {TiledMap} from "@/shared/tiled/loadMap";
import {log} from "./log";

// the server simulation never reads sprite pixels — it only needs the
// collision box and the default sprite size — so we attach a 16x16 placeholder
// asset to every character to satisfy the BasicCharacter shape.
const STUB_SPRITE: SpriteAsset = {
	imageUrl: "",
	sheet: [{index: 0, x: 0, y: 0, width: 16, height: 16}],
};

export type Session = {
	readonly connId: ConnId;
	readonly idIndex: number;
	profile: Profile;
	color: HexColor;
	isAdmin: boolean;
	resumeToken: string;
	character: BasicCharacter;
	inputProvider: StaticInputProvider;
	pendingInputs: Map<number, CharacterInput>;
	lastAppliedClientTick: number;
	// world-px extents of this client's viewport, sizing its interest area.
	// starts at the cap (safe over-coverage) until the client reports its own.
	viewW: number;
	viewH: number;
	// idIndexes whose remote this client currently has materialized — the
	// server-side half of the delta contract in the snapshot codec.
	visible: Set<number>;
	// this session's pose as of the latest snapshot round, and whether that round
	// moved it. both are refreshed at the top of every fan-out, so the
	// per-recipient pass reads them straight off the session it is already
	// holding rather than rebuilding an index over the very same set. compared in
	// wire encoding so quantization can't produce phantom changes.
	pose: SnapshotPose;
	changed: boolean;
};

export type RoomDeps = {readonly map: TiledMap; readonly spawns: ReadonlyArray<SpawnRegion>};

// ticks between snapshot rounds. keep SNAPSHOT_HZ a divisor of TICK_HZ or the
// effective rate silently quantizes to whatever this rounds to.
const TICKS_PER_SNAPSHOT = Math.max(1, Math.round(TICK_HZ / SNAPSHOT_HZ));

// a session as peers see it. the one projection from Session onto the wire shape,
// so the roster in `welcome` and the `join` announcement can't describe the same
// player differently.
export function sessionSnapshot(session: Session): PlayerSnapshot {
	return {
		connId: session.connId,
		idIndex: session.idIndex,
		profile: session.profile,
		color: session.color,
		x: session.character.x,
		y: session.character.y,
		facing: session.character.facing,
	};
}

// authoritative room state. owns the World, the player table, the tick + the
// snapshot fan-out. ws layer hands messages in and pulls broadcasts out via
// the listener API; rooms.ts intentionally does not know about ws at all so
// the sim can be tested headless.
export class Room {
	readonly world: World;
	readonly map: TiledMap;
	private readonly mapPixelWidth: number;
	private readonly mapPixelHeight: number;
	private spawns: ReadonlyArray<SpawnRegion>;
	private sessions = new Map<ConnId, Session>();
	private byIdIndex = new Map<number, Session>();
	private nextIdIndex = 1;
	private freedIds: number[] = [];
	private chatBacklog: ChatMessage[] = [];
	// the same fixed-step accumulator the clients predict through, so a stalled
	// window is caught up (and its backlog dropped) identically on both ends —
	// a divergence there is what the client's clock ratchet has to absorb.
	private readonly clock = new GameClock(TICK_HZ);
	private loopHandle: NodeJS.Timeout | null = null;
	private lastStepAt = 0;
	private listeners: RoomListener[] = [];

	constructor(deps: RoomDeps) {
		this.map = deps.map;
		this.mapPixelWidth = deps.map.width * deps.map.tilewidth;
		this.mapPixelHeight = deps.map.height * deps.map.tileheight;
		this.spawns = deps.spawns;
		this.world = new World(buildWorldGrids(deps.map));
	}

	addListener(listener: RoomListener): void {
		this.listeners.push(listener);
	}

	getTick(): number {
		return this.clock.getCurrentTick();
	}

	getChatBacklog(): ReadonlyArray<ChatMessage> {
		return this.chatBacklog;
	}

	snapshotPlayers(): PlayerSnapshot[] {
		return [...this.sessions.values()].map(sessionSnapshot);
	}

	addSession(opts: {
		connId: ConnId;
		profile: Profile;
		isAdmin: boolean;
		resumeToken: string;
		idIndex?: number;
		pose?: {x: number; y: number; facing: BasicCharacter["facing"]};
	}): Session {
		const idIndex = this.resolveIdIndex(opts.idIndex);
		const inputProvider = new StaticInputProvider();
		const pose = opts.pose ?? sampleSpawn(this.spawns);
		const character = createBasicCharacter({
			id: opts.connId,
			sprite: STUB_SPRITE,
			x: pose.x,
			y: pose.y,
		});
		if (opts.pose) character.facing = opts.pose.facing;
		resolveCharacterCollision(character, this.world.grids);
		this.world.addCharacter(character, inputProvider);
		const session: Session = {
			connId: opts.connId,
			idIndex,
			profile: opts.profile,
			color: profileAccent(opts.profile),
			isAdmin: opts.isAdmin,
			resumeToken: opts.resumeToken,
			character,
			inputProvider,
			pendingInputs: new Map(),
			// acked from the join tick, not 0: ackTickForYou means "replay your
			// recorded inputs from here", and a fresh session has nothing older.
			// acking 0 made clients replay the server's entire uptime after a
			// resume — one frozen loop per snapshot until the first input landed.
			lastAppliedClientTick: this.clock.getCurrentTick(),
			viewW: MAX_VIEW_WORLD_PX,
			viewH: MAX_VIEW_WORLD_PX,
			visible: new Set(),
			pose: poseOf(character, idIndex),
			// a first round needs no forced send: nobody holds this idIndex in
			// their interest set yet — removeSession purges a recycled one from
			// every set — so whoever sees it first takes the newly-visible path,
			// which ships the pose whatever this flag says.
			changed: false,
		};
		this.sessions.set(opts.connId, session);
		this.byIdIndex.set(idIndex, session);
		return session;
	}

	removeSession(connId: ConnId): Session | undefined {
		const session = this.sessions.get(connId);
		if (!session) return undefined;
		this.world.removeCharacter(connId);
		this.sessions.delete(connId);
		this.byIdIndex.delete(session.idIndex);
		this.freedIds.push(session.idIndex);
		// purge the departed idIndex from every interest set now: the `leave`
		// broadcast already despawns the remote client-side, and a recycled
		// idIndex must read as newly-visible to everyone, not as already-known.
		for (const other of this.sessions.values()) other.visible.delete(session.idIndex);
		return session;
	}

	setView(connId: ConnId, w: number, h: number): void {
		const session = this.sessions.get(connId);
		if (!session) return;
		session.viewW = Math.min(w, MAX_VIEW_WORLD_PX);
		session.viewH = Math.min(h, MAX_VIEW_WORLD_PX);
	}

	queueInputs(connId: ConnId, ackTick: number, inputs: ReadonlyArray<CoalescedInput>): void {
		const session = this.sessions.get(connId);
		if (!session || !Number.isInteger(ackTick)) return;
		// bound the acceptance window on both sides: the loop only ever reads the
		// current tick going forward, so anything below serverTick is dead storage
		// that would also stall the idle ack advance in stepOnce — reject it, along
		// with far-future ticks that would never be consumed. the ackTick term
		// hardens the floor against a spoofed batch (a non-finite ackTick can't
		// slip a NaN into it). cap the batch length so a single frame can't inject
		// an unbounded number of entries.
		const serverTick = this.clock.getCurrentTick();
		const floor = Math.max(ackTick, serverTick);
		const ceil = serverTick + MAX_INPUT_LOOKAHEAD_TICKS;
		const limit = Math.min(inputs.length, MAX_INPUTS_PER_MESSAGE);
		for (let i = 0; i < limit; i++) {
			const {tick, input} = inputs[i];
			if (tick < floor || tick > ceil) continue;
			session.pendingInputs.set(tick, input);
		}
	}

	applyProfile(
		connId: ConnId,
		profile: Profile
	): {ok: true; color: HexColor} | {ok: false; reason: string} {
		const session = this.sessions.get(connId);
		if (!session) return {ok: false, reason: "no such session"};
		session.profile = profile;
		session.color = profileAccent(profile);
		return {ok: true, color: session.color};
	}

	teleport(connId: ConnId, x: number, y: number): boolean {
		const session = this.sessions.get(connId);
		if (!session || !session.isAdmin) return false;
		if (x < 0 || y < 0 || x >= this.mapPixelWidth || y >= this.mapPixelHeight) return false;
		teleportToTile(session.character, this.map, this.world.grids, x, y);
		return true;
	}

	// the one way a chat/presence/system line reaches the room: recorded in the
	// backlog a joining client will receive, and broadcast to everyone already
	// here. keeping the pair together is what stops the two from diverging.
	announce(message: ChatMessage): void {
		pushBacklog(this.chatBacklog, message);
		this.broadcast({type: "chat", message});
	}

	start(): void {
		if (this.loopHandle) return;
		this.lastStepAt = Date.now();
		this.loopHandle = setInterval(() => this.runTickWindow(), this.clock.getTickIntervalMs());
		log.info(`room: started at ${TICK_HZ}Hz tick / ${SNAPSHOT_HZ}Hz snapshot`);
	}

	stop(): void {
		if (!this.loopHandle) return;
		clearInterval(this.loopHandle);
		this.loopHandle = null;
	}

	private runTickWindow(): void {
		const now = Date.now();
		const dtMs = now - this.lastStepAt;
		this.lastStepAt = now;
		this.clock.advance(dtMs, (tick, dtSec) => this.stepOnce(tick, dtSec));
	}

	private stepOnce(serverTick: number, dtSec: number): void {
		// queueInputs keeps every pending key within [serverTick, serverTick +
		// lookahead], so consuming (or discarding) the current tick's key is the
		// only sweep the map needs — O(1) per tick, bounded by the lookahead.
		for (const session of this.sessions.values()) {
			const input = session.pendingInputs.get(serverTick);
			if (input) session.inputProvider.setInput(input);
			// ack when this tick's input was applied — or when nothing is queued at
			// all: idle clients don't stream neutral inputs, and this tick's pose
			// still reflects everything they've sent, so acking it is truthful.
			// without the empty-queue case an idle ack would freeze at the last
			// movement tick and grow the prediction replay window without bound.
			// only a queued future input (in-flight lead) holds the ack back, and
			// those are stamped ahead of serverTick, so none is claimed early.
			if (input || session.pendingInputs.size === 0)
				session.lastAppliedClientTick = serverTick;
			session.pendingInputs.delete(serverTick);
		}
		this.world.step(serverTick, dtSec);
		// clear inputs that are spent so the StaticInputProvider doesn't keep
		// reapplying the same motion forever when the client stops sending.
		for (const session of this.sessions.values()) {
			if (!session.pendingInputs.has(serverTick + 1))
				session.inputProvider.setInput(NEUTRAL_INPUT);
		}
		// the world has now advanced *through* serverTick, which is the state the
		// next tick starts from — so the snapshot of it is stamped with that next
		// tick, and the clock reaches it the moment this returns.
		const nextTick = serverTick + 1;
		if (nextTick % TICKS_PER_SNAPSHOT === 0) this.fanOutSnapshot(nextTick);
	}

	// per-recipient delta fan-out: a pose ships only when it entered the
	// recipient's interest area or changed since the previous round, so an idle
	// crowd costs each client nothing but the header. the recipient's own pose
	// always ships — reconciliation must not depend on the delta rules. every
	// client still gets a frame every round: it carries the ack/clock anchor.
	private fanOutSnapshot(serverTick: number): void {
		for (const s of this.sessions.values()) {
			const pose = poseOf(s.character, s.idIndex);
			s.changed = !samePose(s.pose, pose);
			s.pose = pose;
		}
		for (const recipient of this.sessions.values()) {
			const poses: SnapshotPose[] = [];
			const removed: number[] = [];
			for (const subject of this.sessions.values()) {
				if (subject === recipient) {
					poses.push(subject.pose);
					continue;
				}
				const wasVisible = recipient.visible.has(subject.idIndex);
				if (this.inInterest(recipient, subject, wasVisible)) {
					if (!wasVisible) {
						recipient.visible.add(subject.idIndex);
						poses.push(subject.pose);
					} else if (subject.changed) {
						poses.push(subject.pose);
					}
				} else if (wasVisible) {
					recipient.visible.delete(subject.idIndex);
					removed.push(subject.idIndex);
				}
			}
			const buf = encodeSnapshot(serverTick, recipient.lastAppliedClientTick, poses, removed);
			for (const listener of this.listeners) listener.sendBinary(recipient.connId, buf);
		}
	}

	// axis-aligned interest test. the recipient's camera center is derived by
	// approximating the client's follow camera (center on the player, clamped so
	// the view stays inside the map), so the box tracks roughly what the client
	// shows rather than a radius around the character. only an approximation: the
	// client clamps against a viewport inset by the chat panel while reporting the
	// full-window extent, so near a map edge with the panel open the two centers
	// differ — which is part of what the entry/exit margins absorb. admins have no
	// interest bounds at all: they see every player at any zoom.
	private inInterest(recipient: Session, subject: Session, wasVisible: boolean): boolean {
		if (recipient.isAdmin) return true;
		const margin = wasVisible ? INTEREST_EXIT_MARGIN_PX : INTEREST_MARGIN_PX;
		return (
			this.inInterestAxis(
				recipient.character.x,
				subject.character.x,
				recipient.viewW,
				this.mapPixelWidth,
				margin
			) &&
			this.inInterestAxis(
				recipient.character.y,
				subject.character.y,
				recipient.viewH,
				this.mapPixelHeight,
				margin
			)
		);
	}

	private inInterestAxis(
		recipientPos: number,
		subjectPos: number,
		view: number,
		mapPixels: number,
		margin: number
	): boolean {
		const half = view / 2;
		const center =
			mapPixels <= view ? mapPixels / 2 : clamp(recipientPos, half, mapPixels - half);
		return Math.abs(subjectPos - center) <= half + margin;
	}

	broadcast(msg: ServerMessage): void {
		for (const listener of this.listeners) listener.broadcastJson(msg);
	}

	send(connId: ConnId, msg: ServerMessage): void {
		for (const listener of this.listeners) listener.sendJson(connId, msg);
	}

	// resolves the idIndex for a new session. a resumed session asks to keep its
	// stored idIndex; we honor that only when it isn't already held by a live
	// session, and we *reserve* it (pull it from the recycle pool and push
	// nextIdIndex past it) so a later fresh allocation can't hand out the same
	// number. without this reservation two live sessions could share an idIndex,
	// which collapses them into one pose in every snapshot.
	private resolveIdIndex(requested?: number): number {
		if (requested === undefined || this.byIdIndex.has(requested)) return this.allocIdIndex();
		const recycledAt = this.freedIds.indexOf(requested);
		if (recycledAt !== -1) this.freedIds.splice(recycledAt, 1);
		if (requested >= this.nextIdIndex) this.nextIdIndex = requested + 1;
		return requested;
	}

	private allocIdIndex(): number {
		let recycled = this.freedIds.shift();
		while (recycled !== undefined && this.byIdIndex.has(recycled))
			recycled = this.freedIds.shift();
		if (recycled !== undefined) return recycled;
		let next = this.nextIdIndex++;
		while (this.byIdIndex.has(next)) next = this.nextIdIndex++;
		return next;
	}
}

// a character's pose in wire shape. the one place a snapshot pose is assembled,
// so the value a session stores for a round and the one the next round compares
// against can't be built differently.
function poseOf(character: BasicCharacter, idIndex: number): SnapshotPose {
	return {
		idIndex,
		x: character.x,
		y: character.y,
		facing: character.facing,
		walking: character.walking,
		jumping: character.jump !== null || character.teleport !== null,
		animByte: encodeAnimByte(character.animTimeMs),
		jumpOffset: character.jumpOffsetY,
	};
}

function samePose(a: SnapshotPose, b: SnapshotPose): boolean {
	return (
		a.x === b.x &&
		a.y === b.y &&
		a.facing === b.facing &&
		a.walking === b.walking &&
		a.jumping === b.jumping &&
		a.animByte === b.animByte &&
		a.jumpOffset === b.jumpOffset
	);
}

export type RoomListener = {
	broadcastJson: (msg: ServerMessage) => void;
	sendJson: (connId: ConnId, msg: ServerMessage) => void;
	sendBinary: (connId: ConnId, buf: ArrayBuffer) => void;
};
