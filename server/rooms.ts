import {
	createBasicCharacter,
	resolveCharacterCollision,
	type BasicCharacter,
} from "@/game/character";
import {buildCliffGrid, buildHoleGrid, buildSolidGrid} from "@/game/collision";
import {StaticInputProvider} from "@/game/controllers";
import {sampleSpawn, type SpawnRegion} from "@/game/spawn";
import {buildTeleporterGrid} from "@/game/teleport";
import {buildTerrainGrid} from "@/game/terrain";
import {NEUTRAL_INPUT, type CharacterInput} from "@/game/types";
import {World} from "@/game/world";
import {
	encodeSnapshot,
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
};

export type RoomDeps = {readonly map: TiledMap; readonly spawns: ReadonlyArray<SpawnRegion>};

// authoritative room state. owns the World, the player table, the tick + the
// snapshot fan-out. ws layer hands messages in and pulls broadcasts out via
// the listener API; rooms.ts intentionally does not know about ws at all so
// the sim can be tested headless.
export class Room {
	readonly world: World;
	readonly map: TiledMap;
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
		this.spawns = deps.spawns;
		const solidGrid = buildSolidGrid(deps.map);
		const terrainGrid = buildTerrainGrid(deps.map);
		const holeGrid = buildHoleGrid(deps.map);
		const cliffGrid = buildCliffGrid(deps.map);
		const teleporters = buildTeleporterGrid(deps.map);
		this.world = new World(solidGrid, {
			terrain: terrainGrid,
			holes: holeGrid,
			cliffs: cliffGrid,
			teleporters,
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
		return session;
	}

	queueInputs(connId: ConnId, ackTick: number, inputs: ReadonlyArray<CoalescedInput>): void {
		const session = this.sessions.get(connId);
		if (!session) return;
		// drop client acks that lag behind what we've already applied: nothing
		// new to do for those ticks, the pendingInputs entry is gone.
		const floor = Math.max(ackTick, this.serverTick - MAX_INPUT_AGE_TICKS);
		for (const {tick, input} of inputs) {
			if (tick < floor) continue;
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
		for (const session of this.sessions.values()) {
			const input = session.pendingInputs.get(this.serverTick);
			if (input) {
				session.inputProvider.setInput(input);
				session.lastAppliedClientTick = this.serverTick;
				session.pendingInputs.delete(this.serverTick);
			}
			// drop stale entries the client never re-acked
			for (const tick of session.pendingInputs.keys()) {
				if (tick < this.serverTick - MAX_INPUT_AGE_TICKS)
					session.pendingInputs.delete(tick);
			}
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

	private fanOutSnapshot(): void {
		const poses: SnapshotPose[] = [];
		for (const s of this.sessions.values()) {
			poses.push({
				idIndex: s.idIndex,
				x: s.character.x,
				y: s.character.y,
				facing: s.character.facing,
				walking: s.character.walking,
				jumping: s.character.jump !== null || s.character.teleport !== null,
				animByte: Math.min(255, Math.round(s.character.animTimeMs / 16)) & 0xff,
				jumpOffset: s.character.jumpOffsetY,
			});
		}
		for (const listener of this.listeners) {
			for (const s of this.sessions.values()) {
				const buf = encodeSnapshot(this.serverTick, s.lastAppliedClientTick, poses);
				listener.sendBinary(s.connId, buf);
			}
		}
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

export type RoomListener = {
	broadcastJson: (msg: ServerMessage) => void;
	sendJson: (connId: ConnId, msg: ServerMessage) => void;
	sendBinary: (connId: ConnId, buf: ArrayBuffer) => void;
};
