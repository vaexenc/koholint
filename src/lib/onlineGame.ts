import {AVATARS} from "@/components/avatar-picker/registry";
import {
	collectSpawnRegions,
	createBasicCharacter,
	drawMovementHint,
	GameClock,
	isMovementLearned,
	KeyboardInputProvider,
	lerp,
	sampleSpawnOrCenter,
	StaticInputProvider,
	type BasicCharacter,
	type World,
} from "@/game";
import {type Direction} from "@/game/types";
import {
	applyRemoteInterp,
	recordRemotePose,
	REMOTE_INTERP_DELAY_MS,
	type RemoteEntry,
} from "@/lib/remoteInterp";
import {ServerClock} from "@/lib/serverClock";
import {replayLocalInputs, type WsClient} from "@/lib/wsClient";
import type {MapRendererInitContext} from "@/pages/useMapRenderer";
import {
	type ConnId,
	type DecodedSnapshot,
	type PlayerSnapshot,
	type Profile,
	type ServerProfileChanged,
	type ServerWelcome,
} from "@/protocol";
import {PALETTES} from "@/sprites/palettes";

// the server's authoritative tick rate (HANDOFF locks 30Hz). client mirrors it
// so locally-predicted ticks line up with server ticks 1:1 after the offset.
const SERVER_TICK_HZ = 30;
const SELF_ENTITY_ID = "self";

function resolveAvatarSprite(avatarId: string) {
	return (AVATARS.find((a) => a.id === avatarId) ?? AVATARS[0]).sprite;
}

function resolvePaletteSwap(paletteId: string | null) {
	if (!paletteId) return undefined;
	return PALETTES.find((p) => p.id === paletteId)?.palette;
}

export type OnlineGameDeps = {
	readonly profile: () => Profile;
	readonly movementInitiallyLearned: boolean;
	readonly onMovementLearned: () => void;
};

// owns the multiplayer simulation state for one map load: the self character
// + keyboard, the remote roster, the server-tick clock, and the
// welcome/snapshot/join/leave application logic. the page wires WS events
// into the apply* methods and forwards the per-frame step.
export class OnlineGame {
	readonly selfChar: BasicCharacter;
	readonly selfKeyboard: KeyboardInputProvider;
	readonly spawn: {readonly x: number; readonly y: number};
	private readonly world: World;
	private readonly renderer: MapRendererInitContext["renderer"];
	private readonly serverClock: ServerClock;
	private readonly tickIntervalMs = 1000 / SERVER_TICK_HZ;
	private readonly remotes = new Map<number, RemoteEntry>();
	private readonly remotesByConnId = new Map<ConnId, RemoteEntry>();
	private readonly deps: OnlineGameDeps;
	private _selfConnId: ConnId | null = null;
	private selfIdIndex: number | null = null;
	private selfSpawned = false;
	private pendingSelfSnap: {x: number; y: number; facing: Direction} | null = null;
	private movementLearned: boolean;

	constructor(ctx: MapRendererInitContext, deps: OnlineGameDeps) {
		this.deps = deps;
		this.world = ctx.world;
		this.renderer = ctx.renderer;
		this.serverClock = new ServerClock(new GameClock(SERVER_TICK_HZ));
		this.selfKeyboard = new KeyboardInputProvider();
		this.spawn = sampleSpawnOrCenter(
			collectSpawnRegions(ctx.map),
			ctx.mapPixelWidth,
			ctx.mapPixelHeight
		);
		const profile = deps.profile();
		this.selfChar = createBasicCharacter({
			id: SELF_ENTITY_ID,
			sprite: resolveAvatarSprite(profile.avatarId),
			paletteSwap: resolvePaletteSwap(profile.paletteId),
			x: this.spawn.x,
			y: this.spawn.y,
		});
		this.movementLearned = deps.movementInitiallyLearned;
	}

	setKeyboardEnabled(enabled: boolean): void {
		this.selfKeyboard.setEnabled(enabled);
	}

	get selfConnId(): ConnId | null {
		return this._selfConnId;
	}

	applyWelcome(msg: ServerWelcome): void {
		this._selfConnId = msg.connId;
		const selfPlayer = msg.players.find((p) => p.connId === msg.connId) ?? null;
		this.selfIdIndex = selfPlayer ? selfPlayer.idIndex : null;
		this.serverClock.resetToServerTick(msg.serverTick);
		this.pendingSelfSnap = {x: msg.spawn.x, y: msg.spawn.y, facing: "down"};
		for (const r of this.remotesByConnId.values()) this.removeRemote(r.connId);
		for (const p of msg.players) if (p.connId !== msg.connId) this.addRemote(p);
	}

	applyJoin(player: PlayerSnapshot): void {
		if (player.connId === this._selfConnId) {
			this.selfIdIndex = player.idIndex;
			return;
		}
		this.addRemote(player);
	}

	applyLeave(connId: ConnId): void {
		this.removeRemote(connId);
	}

	applyProfileChanged(msg: ServerProfileChanged): void {
		const remote = this.remotesByConnId.get(msg.connId);
		if (!remote) return;
		remote.profile = msg.profile;
		remote.color = msg.color;
		remote.character.sprite = resolveAvatarSprite(msg.profile.avatarId);
		remote.character.paletteSwap = resolvePaletteSwap(msg.profile.paletteId);
		this.invalidateRemote(msg.connId);
	}

	applySnapshot(snap: DecodedSnapshot, ws: WsClient): void {
		// re-anchor our server-tick estimate on every snapshot — ratchets up only
		// (see ServerClock.syncToServerTick) so a local stall can't fall behind.
		this.serverClock.syncToServerTick(snap.serverTick);
		const now = performance.now();
		const dtSec = this.tickIntervalMs / 1000;
		for (const pose of snap.poses) {
			if (pose.idIndex === this.selfIdIndex) {
				// a jump/teleport is a deterministic, input-locked animation the
				// client and server run identically but offset in time (our
				// prediction leads the server). suspend reconciliation while
				// *either* side is mid-animation: snapping to a mid-hop pose —
				// which sits over a hole, illegal for walking physics — would
				// corrupt the replay and is the hole-hop jitter. the client clears
				// its own jump first (it leads), so pose.jumping covers the tail
				// window where the server is still hopping. reconciliation resumes
				// once both sides land, correcting any residual drift then.
				if (this.selfChar.jump || this.selfChar.teleport || pose.jumping) continue;
				// the pose reflects our inputs applied through snap.ackTickForYou
				// (the last of *our* inputs the server consumed) — not
				// snap.serverTick, which is just the sim's frame counter and runs
				// ahead of our ack. anchoring on serverTick skipped the first
				// un-acked input every snapshot. replay from the ack up to the
				// last tick we've locally simulated (currentServerTick - 1) to
				// rebuild the prediction on top of authoritative truth.
				const currentServerTick = this.serverClock.currentServerTick();
				replayLocalInputs(
					this.world,
					this.selfChar,
					pose,
					snap.ackTickForYou,
					currentServerTick - 1,
					dtSec,
					ws.getRecordedInputs()
				);
				continue;
			}
			const remote = this.remotes.get(pose.idIndex);
			if (remote) recordRemotePose(remote, pose, now);
		}
	}

	applySelfProfile(profile: Profile): void {
		this.selfChar.sprite = resolveAvatarSprite(profile.avatarId);
		this.selfChar.paletteSwap = resolvePaletteSwap(profile.paletteId);
		this.invalidateSelf();
	}

	step(dtMs: number, ws: WsClient | null): number {
		if (this.pendingSelfSnap) {
			const snap = this.pendingSelfSnap;
			this.pendingSelfSnap = null;
			this.spawnSelf();
			this.selfChar.x = snap.x;
			this.selfChar.y = snap.y;
			this.selfChar.prevX = snap.x;
			this.selfChar.prevY = snap.y;
			this.selfChar.facing = snap.facing;
			this.selfChar.walking = false;
			this.selfChar.jump = null;
			this.selfChar.teleport = null;
			this.selfChar.jumpOffsetY = 0;
			this.selfChar.prevJumpOffsetY = 0;
		}
		this.serverClock.advance(dtMs, (localTick, dtSec) => {
			const inputs = this.world.sampleInputs(localTick, dtSec);
			const selfInput = inputs.get(SELF_ENTITY_ID);
			if (selfInput) ws?.recordInput(this.serverClock.serverTickFor(localTick), selfInput);
			this.world.applyInputs(inputs, dtSec);
		});
		const renderAt = performance.now() - REMOTE_INTERP_DELAY_MS;
		for (const r of this.remotes.values()) applyRemoteInterp(r, renderAt);
		ws?.flushInputs(this.serverClock.currentServerTick());
		return this.serverClock.getInterpolationAlpha();
	}

	// no follow target until the welcome has actually placed the self
	// character into the world; the renderer leaves the camera on the spawn
	// area until then.
	followTarget(): BasicCharacter | null {
		return this.selfSpawned ? this.selfChar : null;
	}

	drawScreenOverlay(
		ctx: CanvasRenderingContext2D,
		alpha: number,
		worldToScreen: (x: number, y: number) => readonly [number, number]
	): void {
		if (!this.selfSpawned || this.movementLearned) return;
		const seen = this.selfKeyboard.getSeenKeys();
		if (isMovementLearned(seen)) {
			this.movementLearned = true;
			this.deps.onMovementLearned();
			return;
		}
		const [screenX, screenY] = worldToScreen(
			lerp(this.selfChar.prevX, this.selfChar.x, alpha) + this.selfChar.spriteWidth / 2,
			lerp(this.selfChar.prevY, this.selfChar.y, alpha) + this.selfChar.spriteHeight
		);
		drawMovementHint(ctx, screenX, screenY, seen, performance.now());
	}

	// deferred until the welcome's spawn is applied (see step). idempotent
	// so a resume/reconnect that re-welcomes doesn't double-register.
	private spawnSelf(): void {
		if (this.selfSpawned) return;
		// selfChar was built at map-load with the then-current avatar; the
		// player may have picked a different one in the gate before joining,
		// so re-apply the latest profile before the sprite first renders.
		const profile = this.deps.profile();
		this.selfChar.sprite = resolveAvatarSprite(profile.avatarId);
		this.selfChar.paletteSwap = resolvePaletteSwap(profile.paletteId);
		this.world.addCharacter(this.selfChar, this.selfKeyboard);
		this.selfSpawned = true;
		this.renderer.ensureLoaded([this.selfChar]).catch(() => {});
	}

	private addRemote(player: PlayerSnapshot): void {
		if (this.remotesByConnId.has(player.connId)) return;
		const char = createBasicCharacter({
			id: `remote:${player.connId}`,
			sprite: resolveAvatarSprite(player.profile.avatarId),
			paletteSwap: resolvePaletteSwap(player.profile.paletteId),
			x: player.x,
			y: player.y,
			facing: player.facing,
		});
		this.world.addCharacter(char, new StaticInputProvider());
		const entry: RemoteEntry = {
			connId: player.connId,
			idIndex: player.idIndex,
			profile: player.profile,
			color: player.color,
			character: char,
			samples: [
				{
					x: player.x,
					y: player.y,
					facing: player.facing,
					walking: false,
					animByte: 0,
					jumpOffset: 0,
					at: performance.now(),
				},
			],
		};
		this.remotes.set(player.idIndex, entry);
		this.remotesByConnId.set(player.connId, entry);
		this.renderer.ensureLoaded([char]).catch(() => {});
	}

	private removeRemote(connId: ConnId): void {
		const r = this.remotesByConnId.get(connId);
		if (!r) return;
		this.remotes.delete(r.idIndex);
		this.remotesByConnId.delete(connId);
		this.world.removeCharacter(r.character.id);
	}

	private invalidateRemote(connId: ConnId): void {
		const r = this.remotesByConnId.get(connId);
		if (!r) return;
		this.renderer.invalidate(r.character.id);
		this.renderer.ensureLoaded([r.character]).catch(() => {});
	}

	private invalidateSelf(): void {
		this.renderer.invalidate(this.selfChar.id);
		this.renderer.ensureLoaded([this.selfChar]).catch(() => {});
	}
}
