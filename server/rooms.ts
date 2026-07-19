import {
	createBasicCharacter,
	resolveCharacterCollision,
	type BasicCharacter,
} from "@/game/character";
import {buildCliffGrid, buildHoleGrid, buildSolidGrid} from "@/game/collision";
import {StaticInputProvider} from "@/game/controllers";
import {buildPushGrid} from "@/game/push";
import {sampleSpawn, type SpawnRegion} from "@/game/spawn";
import {buildTeleporterGrid} from "@/game/teleport";
import {buildTerrainGrid} from "@/game/terrain";
import {NEUTRAL_INPUT, type CharacterInput} from "@/game/types";
import {World} from "@/game/world";
import {
	encodeAnimByte,
	encodeSnapshot,
	INTEREST_EXIT_MARGIN_PX,
	INTEREST_MARGIN_PX,
	MAX_INPUTS_PER_MESSAGE,
	MAX_VIEW_WORLD_PX,
	type ChatMessage,
	type CoalescedInput,
	type ConnId,
	type PlayerSnapshot,
	type Profile,
	type ServerMessage,
	type SnapshotPose,
} from "@/protocol";
import {paletteAccent} from "@/sprites/paletteAccent";
import type {TiledMap} from "@/tiled/loadMap";
import type {HexColor, SpriteAsset} from "@/types";
import {log} from "./log";

// the server simulation never reads sprite pixels — it only needs the
// collision box and the default sprite size — so we attach a 16x16 placeholder
// asset to every character to satisfy the BasicCharacter shape.
const STUB_SPRITE: SpriteAsset = {
	imageUrl: "",
	sheet: [{index: 0, x: 0, y: 0, width: 16, height: 16}],
};

export const TICK_HZ = 30;
export const SNAPSHOT_HZ = 15;
export const CHAT_BACKLOG_SIZE = 200;
export const MAX_INPUT_AGE_TICKS = TICK_HZ * 30;
// clients stamp inputs against their own estimate of the server clock, so a
// small lead over serverTick is normal (latency + clock skew). accept up to a
// second of lookahead; ticks beyond that are rejected as junk that would
// otherwise sit in pendingInputs unconsumed.
export const MAX_INPUT_LOOKAHEAD_TICKS = TICK_HZ;

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
	// pose as of the previous snapshot round, for change detection. compared in
	// wire encoding so quantization can't produce phantom changes.
	lastPose: SnapshotPose | null;
};

export type RoomDeps = {readonly map: TiledMap; readonly spawns: ReadonlyArray<SpawnRegion>};

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
	private serverTick = 0;
	private readonly tickIntervalMs = 1000 / TICK_HZ;
	private readonly snapshotIntervalMs = 1000 / SNAPSHOT_HZ;
	private ticksPerSnapshot = Math.max(
		1,
		Math.round(this.tickIntervalMs > 0 ? this.snapshotIntervalMs / this.tickIntervalMs : 1)
	);
	private loopHandle: NodeJS.Timeout | null = null;
	private accumulatorMs = 0;
	private lastStepAt = 0;
	private listeners: RoomListener[] = [];
	readonly startTimeMs = Date.now();

	constructor(deps: RoomDeps) {
		this.map = deps.map;
		this.mapPixelWidth = deps.map.width * deps.map.tilewidth;
		this.mapPixelHeight = deps.map.height * deps.map.tileheight;
		this.spawns = deps.spawns;
		const solidGrid = buildSolidGrid(deps.map);
		const terrainGrid = buildTerrainGrid(deps.map);
		const holeGrid = buildHoleGrid(deps.map);
		const cliffGrid = buildCliffGrid(deps.map);
		const teleporters = buildTeleporterGrid(deps.map);
		const pushGrid = buildPushGrid(deps.map);
		this.world = new World(solidGrid, {
			terrain: terrainGrid,
			holes: holeGrid,
			cliffs: cliffGrid,
			teleporters,
			push: pushGrid,
		});
	}

	addListener(listener: RoomListener): void {
		this.listeners.push(listener);
	}

	getTick(): number {
		return this.serverTick;
	}

	getChatBacklog(): ReadonlyArray<ChatMessage> {
		return this.chatBacklog;
	}

	getSessions(): ReadonlyMap<ConnId, Session> {
		return this.sessions;
	}

	snapshotPlayers(): PlayerSnapshot[] {
		const out: PlayerSnapshot[] = [];
		for (const s of this.sessions.values()) {
			out.push({
				connId: s.connId,
				idIndex: s.idIndex,
				profile: s.profile,
				color: s.color,
				x: s.character.x,
				y: s.character.y,
				facing: s.character.facing,
			});
		}
		return out;
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
		if (opts.pose?.facing) character.facing = opts.pose.facing;
		resolveCharacterCollision(character, this.world.grid, this.world.holes);
		this.world.addCharacter(character, inputProvider);
		const session: Session = {
			connId: opts.connId,
			idIndex,
			profile: opts.profile,
			color: paletteAccent(opts.profile.paletteId),
			isAdmin: opts.isAdmin,
			resumeToken: opts.resumeToken,
			character,
			inputProvider,
			pendingInputs: new Map(),
			lastAppliedClientTick: 0,
			viewW: MAX_VIEW_WORLD_PX,
			viewH: MAX_VIEW_WORLD_PX,
			visible: new Set(),
			lastPose: null,
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
		// bound the acceptance window on both sides: drop acks that lag behind
		// what we've already applied (a non-finite ackTick can't slip a NaN into
		// the floor now), and reject far-future ticks that would never be
		// consumed and would pile up unswept. cap the batch length so a single
		// frame can't inject an unbounded number of entries.
		const floor = Math.max(ackTick, this.serverTick - MAX_INPUT_AGE_TICKS);
		const ceil = this.serverTick + MAX_INPUT_LOOKAHEAD_TICKS;
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
		session.color = paletteAccent(profile.paletteId);
		return {ok: true, color: session.color};
	}

	teleport(connId: ConnId, x: number, y: number): boolean {
		const session = this.sessions.get(connId);
		if (!session || !session.isAdmin) return false;
		const map = this.map;
		if (x < 0 || y < 0 || x >= map.width * map.tilewidth || y >= map.height * map.tileheight)
			return false;
		const tileX = Math.floor(x / map.tilewidth);
		const tileY = Math.floor(y / map.tileheight);
		if (tileX < 0 || tileY < 0 || tileX >= map.width || tileY >= map.height) return false;
		const c = session.character;
		const box = c.collisionBox;
		c.x = (tileX + 0.5) * map.tilewidth - (box.x + box.width / 2);
		c.y = (tileY + 0.5) * map.tileheight - (box.y + box.height / 2);
		c.prevX = c.x;
		c.prevY = c.y;
		c.jump = null;
		c.teleport = null;
		c.jumpOffsetY = 0;
		c.prevJumpOffsetY = 0;
		c.walking = false;
		c.animTimeMs = 0;
		resolveCharacterCollision(c, this.world.grid, this.world.holes);
		return true;
	}

	pushChat(msg: ChatMessage): void {
		this.chatBacklog.push(msg);
		if (this.chatBacklog.length > CHAT_BACKLOG_SIZE)
			this.chatBacklog.splice(0, this.chatBacklog.length - CHAT_BACKLOG_SIZE);
	}

	start(): void {
		if (this.loopHandle) return;
		this.lastStepAt = Date.now();
		this.loopHandle = setInterval(() => this.runTickWindow(), this.tickIntervalMs);
		log.info(`room: started at ${TICK_HZ}Hz tick / ${SNAPSHOT_HZ}Hz snapshot`);
	}

	stop(): void {
		if (!this.loopHandle) return;
		clearInterval(this.loopHandle);
		this.loopHandle = null;
	}

	private runTickWindow(): void {
		const now = Date.now();
		this.accumulatorMs += Math.min(now - this.lastStepAt, this.tickIntervalMs * 8);
		this.lastStepAt = now;
		while (this.accumulatorMs >= this.tickIntervalMs) {
			this.stepOnce();
			this.accumulatorMs -= this.tickIntervalMs;
		}
	}

	private stepOnce(): void {
		const dtSec = this.tickIntervalMs / 1000;
		// queueInputs keeps every pending key within
		// [serverTick - MAX_INPUT_AGE_TICKS, serverTick + lookahead]. serverTick
		// advances one at a time, so consuming the current tick and dropping the
		// single key that just fell off the trailing edge keeps the map bounded in
		// O(1) per tick — no full-map rescan, which an injected backlog used to tax.
		const agedOutTick = this.serverTick - MAX_INPUT_AGE_TICKS - 1;
		for (const session of this.sessions.values()) {
			const input = session.pendingInputs.get(this.serverTick);
			if (input) {
				session.inputProvider.setInput(input);
				session.lastAppliedClientTick = this.serverTick;
			}
			session.pendingInputs.delete(this.serverTick);
			session.pendingInputs.delete(agedOutTick);
		}
		this.world.step(this.serverTick, dtSec);
		// clear inputs that are spent so the StaticInputProvider doesn't keep
		// reapplying the same motion forever when the client stops sending.
		for (const session of this.sessions.values()) {
			if (!session.pendingInputs.has(this.serverTick + 1))
				session.inputProvider.setInput(NEUTRAL_INPUT);
		}
		this.serverTick++;
		if (this.serverTick % this.ticksPerSnapshot === 0) this.fanOutSnapshot();
	}

	// per-recipient delta fan-out: a pose ships only when it entered the
	// recipient's interest area or changed since the previous round, so an idle
	// crowd costs each client nothing but the header. the recipient's own pose
	// always ships — reconciliation must not depend on the delta rules. every
	// client still gets a frame every round: it carries the ack/clock anchor.
	private fanOutSnapshot(): void {
		const changed = new Map<number, boolean>();
		const poseById = new Map<number, SnapshotPose>();
		for (const s of this.sessions.values()) {
			const pose: SnapshotPose = {
				idIndex: s.idIndex,
				x: s.character.x,
				y: s.character.y,
				facing: s.character.facing,
				walking: s.character.walking,
				jumping: s.character.jump !== null || s.character.teleport !== null,
				animByte: encodeAnimByte(s.character.animTimeMs),
				jumpOffset: s.character.jumpOffsetY,
			};
			poseById.set(s.idIndex, pose);
			changed.set(s.idIndex, s.lastPose === null || !samePose(s.lastPose, pose));
			s.lastPose = pose;
		}
		for (const recipient of this.sessions.values()) {
			const poses: SnapshotPose[] = [];
			const removed: number[] = [];
			for (const subject of this.sessions.values()) {
				const pose = poseById.get(subject.idIndex);
				if (!pose) continue;
				if (subject === recipient) {
					poses.push(pose);
					continue;
				}
				const wasVisible = recipient.visible.has(subject.idIndex);
				if (this.inInterest(recipient, subject, wasVisible)) {
					if (!wasVisible) {
						recipient.visible.add(subject.idIndex);
						poses.push(pose);
					} else if (changed.get(subject.idIndex)) {
						poses.push(pose);
					}
				} else if (wasVisible) {
					recipient.visible.delete(subject.idIndex);
					removed.push(subject.idIndex);
				}
			}
			const buf = encodeSnapshot(
				this.serverTick,
				recipient.lastAppliedClientTick,
				poses,
				removed
			);
			for (const listener of this.listeners) listener.sendBinary(recipient.connId, buf);
		}
	}

	// axis-aligned interest test. the recipient's camera center is derived with
	// the same edge clamp the client's follow camera applies (center on the
	// player, clamped so the view stays inside the map), so the box tracks what
	// the client actually shows, not just a radius around the character. admins
	// have no interest bounds — they see every player at any zoom.
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
			mapPixels <= view
				? mapPixels / 2
				: Math.min(mapPixels - half, Math.max(half, recipientPos));
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
