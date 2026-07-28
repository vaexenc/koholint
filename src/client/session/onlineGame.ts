import {perfCount, perfGauge, perfSample} from "@/client/lib/perfHud";
import {appearanceOf} from "@/client/session/appearance";
import type {GameHostContext} from "@/client/session/gameHost";
import type {MapGame} from "@/client/session/mapGame";
import type {PlayerPose} from "@/client/session/playerPose";
import {REMOTE_INTERP_DELAY_MS} from "@/client/session/remoteInterp";
import {RemoteRoster} from "@/client/session/remoteRoster";
import {SelfAvatar} from "@/client/session/selfAvatar";
import {SelfControls} from "@/client/session/selfControls";
import {ServerClock} from "@/client/session/serverClock";
import {WorldOverlays, type LabelledCharacter} from "@/client/session/worldOverlays";
import {sameMovementBindings} from "@/client/settings/movementBindings";
import {
	collectSpawnRegions,
	collisionCenter,
	createBasicCharacter,
	DEFAULT_KEY_BINDINGS,
	GameClock,
	sampleSpawnOrCenter,
	type BasicCharacter,
	type KeyBindings,
	type World,
} from "@/shared/game";
import {inputHasMovement, type CharacterInput} from "@/shared/game/types";
import {
	TICK_HZ,
	type ConnId,
	type PlayerSnapshot,
	type Profile,
	type ServerProfileChanged,
	type ServerWelcome,
} from "@/shared/protocol";
import type {DecodedSnapshot} from "@/shared/protocol/snapshot";
import {profileAccent} from "@/shared/sprites/profileAccent";

const SELF_ENTITY_ID = "self";

// what the game needs from the network layer (TabSyncedClient provides it).
// the game stays ignorant of which browser tab actually owns the socket; it
// only asks whether *this* tab is the one driving the shared avatar.
export type GameNet = {
	recordInput(tick: number, input: CharacterInput): void;
	flushInputs(currentTick: number): void;
	getRecordedInputs(): ReadonlyMap<number, CharacterInput>;
	isController(): boolean;
};

export type OnlineGameDeps = {
	readonly profile: () => Profile;
	// the tab's connection, which outlives every map load on the page — so the
	// game holds it rather than being handed it back on every frame and every
	// snapshot. taking it as a dependency is what keeps `step` free of a net
	// parameter, and with it free of a "no connection" case that never happens.
	readonly net: GameNet;
	readonly movementInitiallyLearned: boolean;
	readonly onMovementLearned: () => void;
};

// the multiplayer session for one map load, as three owned pieces and the
// routing between them: SelfAvatar is the local body and how its pose is
// decided, RemoteRoster is everyone else, WorldOverlays is what hangs above
// them. what's left here is the server-tick clock, the welcome/snapshot/join/
// leave switch, and the per-frame order the three run in. MapGame is the part
// of its surface OfflineGame mirrors; everything below that is the network's.
export class OnlineGame implements MapGame {
	readonly controls: SelfControls;
	private readonly self: SelfAvatar;
	private readonly world: World;
	private readonly serverClock: ServerClock;
	// everyone else in the room: roster, characters, world membership.
	private readonly remotes: RemoteRoster;
	// name tags, chat bubbles and the movement hint, and all the state that is
	// only theirs.
	private readonly overlays: WorldOverlays;
	private readonly deps: OnlineGameDeps;
	private readonly net: GameNet;
	private _selfConnId: ConnId | null = null;

	constructor(ctx: GameHostContext, deps: OnlineGameDeps) {
		this.deps = deps;
		this.net = deps.net;
		this.world = ctx.world;
		this.remotes = new RemoteRoster(ctx.world, ctx.renderer);
		this.serverClock = new ServerClock(new GameClock(TICK_HZ));
		// a provisional local position only — the welcome's spawn replaces it
		// before the character ever renders (see SelfAvatar.applyPendingSpawn).
		const spawn = sampleSpawnOrCenter(
			collectSpawnRegions(ctx.map),
			ctx.mapPixelWidth,
			ctx.mapPixelHeight
		);
		const character = createBasicCharacter({
			id: SELF_ENTITY_ID,
			...appearanceOf(deps.profile()),
			x: spawn.x,
			y: spawn.y,
		});
		this.controls = new SelfControls({
			screenToWorld: ctx.screenToWorld,
			origin: () => collisionCenter(character),
		});
		this.self = new SelfAvatar(character, {
			world: ctx.world,
			renderer: ctx.renderer,
			profile: deps.profile,
			recordedInputs: () => deps.net.getRecordedInputs(),
			inputs: this.controls.provider,
		});
		this.overlays = new WorldOverlays(
			{
				labelled: () => this.labelledCharacters(),
				knowsSpeaker: (connId) => connId === this._selfConnId || this.remotes.has(connId),
				characterFor: (connId) => this.characterFor(connId),
				self: () => this.self.inWorld(),
			},
			{
				controls: this.controls,
				initiallyLearned: deps.movementInitiallyLearned,
				onLearned: deps.onMovementLearned,
			}
		);
	}

	// the local body, for the page's initial camera focus. its pose is the
	// avatar's business; this is only the identity the camera aims at.
	get selfChar(): BasicCharacter {
		return this.self.character;
	}

	setKeyBindings(bindings: KeyBindings): void {
		this.controls.setBindings(bindings);
		// the movement hint teaches the default keys; a player running custom
		// bindings chose them in settings and would only be shown wrong keys.
		if (!sameMovementBindings(bindings, DEFAULT_KEY_BINDINGS))
			this.overlays.retireMovementHint();
	}

	get selfConnId(): ConnId | null {
		return this._selfConnId;
	}

	applyWelcome(msg: ServerWelcome): void {
		this._selfConnId = msg.connId;
		const selfPlayer = msg.players.find((p) => p.connId === msg.connId) ?? null;
		this.self.setIdIndex(selfPlayer ? selfPlayer.idIndex : null);
		this.serverClock.resetToServerTick(msg.serverTick);
		this.self.placeOnNextStep({x: msg.spawn.x, y: msg.spawn.y, facing: "down"});
		// a re-welcome describes the room from scratch, so the old roster goes —
		// along with the bubbles hanging over the players in it.
		for (const connId of this.remotes.clear()) this.overlays.dropSpeaker(connId);
		for (const p of msg.players) if (p.connId !== msg.connId) this.remotes.add(p);
	}

	applyJoin(player: PlayerSnapshot): void {
		if (player.connId === this._selfConnId) {
			this.self.setIdIndex(player.idIndex);
			return;
		}
		this.remotes.add(player);
	}

	applyLeave(connId: ConnId): void {
		// a player who left takes their bubbles with them. the roster owns the
		// entity, the overlays own what hangs above it.
		if (this.remotes.remove(connId)) this.overlays.dropSpeaker(connId);
	}

	applyProfileChanged(msg: ServerProfileChanged): void {
		this.remotes.setProfile(msg.connId, msg.profile, msg.color);
	}

	applySnapshot(snap: DecodedSnapshot): void {
		// re-anchor our server-tick estimate on every snapshot — ratchets up only
		// (see ServerClock.syncToServerTick) so a local stall can't fall behind.
		this.serverClock.syncToServerTick(snap.serverTick);
		perfCount("snapshots");
		perfSample("snap poses", snap.poses.length);
		const now = performance.now();
		for (const idIndex of snap.removed) this.remotes.hide(idIndex);
		for (const pose of snap.poses) {
			if (this.self.owns(pose.idIndex))
				this.self.applyPose(
					pose,
					snap.ackTickForYou,
					this.serverClock.currentServerTick(),
					now
				);
			else this.remotes.record(pose, now);
		}
		perfSample("snapshot handler ms", performance.now() - now);
	}

	pushChatBubble(senderId: ConnId, text: string): void {
		this.overlays.pushChatBubble(senderId, text);
	}

	setChatBubblesEnabled(enabled: boolean): void {
		this.overlays.setChatBubblesEnabled(enabled);
	}

	setNameTagsEnabled(enabled: boolean): void {
		this.overlays.setNameTagsEnabled(enabled);
	}

	applySelfProfile(profile: Profile): void {
		this.self.applyProfile(profile);
	}

	step(dtMs: number): number {
		perfGauge("remotes", this.remotes.size);
		perfGauge("world chars", this.world.characters.size);
		this.self.syncControl(this.net.isController());
		this.self.applyPendingSpawn();
		const steps = this.serverClock.advance(dtMs, (localTick, dtSec) => {
			const inputs = this.world.sampleInputs(localTick, dtSec);
			const selfInput = inputs.get(SELF_ENTITY_ID);
			// neutral ticks stay off the wire and out of the buffer: the server
			// falls back to NEUTRAL_INPUT for any tick with nothing queued and
			// prediction replay fills gaps the same way, so absence already means
			// neutral on both ends. an idle player therefore streams nothing.
			if (selfInput && inputHasMovement(selfInput))
				this.net.recordInput(this.serverClock.serverTickFor(localTick), selfInput);
			this.world.applyInputs(inputs, dtSec);
		});
		const renderAt = performance.now() - REMOTE_INTERP_DELAY_MS;
		this.remotes.interpolate(renderAt);
		this.self.interpolate(renderAt);
		// the net layer gates flushing on being the controller, so tabs never
		// send competing inputs for the same ticks over the shared connection.
		// flush only on frames that stepped: a recorded input goes out on the tick
		// it was sampled, and in-between render frames would only resend an
		// identical redundant batch.
		if (steps > 0) this.net.flushInputs(this.serverClock.currentServerTick());
		return this.serverClock.getInterpolationAlpha();
	}

	// no follow target until the welcome has actually placed the self
	// character into the world; the renderer keeps the camera wherever it
	// started (handed-off focus or map center) until then.
	followTarget(): BasicCharacter | null {
		return this.self.inWorld();
	}

	// last known pose of the self character, for handing off to the offline
	// map when switching modes; null until the welcome has placed it.
	selfPose(): PlayerPose | null {
		return this.self.pose();
	}

	drawScreenOverlay(
		ctx: CanvasRenderingContext2D,
		alpha: number,
		worldToScreen: (x: number, y: number) => readonly [number, number],
		textScale: number
	): void {
		this.overlays.draw(ctx, alpha, worldToScreen, textScale);
	}

	// everyone in the world who carries a name tag. the server derives a
	// player's color the same way profileAccent does, so the self tag matches
	// what everyone else sees without waiting for a broadcast.
	private *labelledCharacters(): Generator<LabelledCharacter> {
		for (const r of this.remotes.inWorld())
			yield {character: r.character, name: r.profile.name, color: r.color};
		const self = this.self.inWorld();
		if (self) {
			const profile = this.deps.profile();
			yield {character: self, name: profile.name, color: profileAccent(profile)};
		}
	}

	private characterFor(connId: ConnId): BasicCharacter | null {
		if (connId === this._selfConnId) return this.self.inWorld();
		return this.remotes.characterFor(connId);
	}
}
