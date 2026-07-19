import {resolveAvatarSprite} from "@/components/avatar-picker/registry";
import {
	collectSpawnRegions,
	collisionCenter,
	CompositeInputProvider,
	createBasicCharacter,
	DEFAULT_KEY_BINDINGS,
	drawChatBubbles,
	drawMovementHint,
	drawNameTag,
	drawTouchMovementHint,
	GameClock,
	isMovementLearned,
	KeyboardInputProvider,
	lerp,
	NAME_TAG_HEIGHT,
	overlayTextScale,
	PointerSteerInputProvider,
	pruneChatBubbles,
	pushChatBubble,
	sampleSpawnOrCenter,
	StaticInputProvider,
	type BasicCharacter,
	type ChatBubble,
	type KeyBindings,
	type World,
} from "@/game";
import {type CharacterInput, type Direction} from "@/game/types";
import {sameMovementBindings} from "@/lib/movementBindings";
import {hasCoarsePointer} from "@/lib/pointerType";
import {
	applyRemoteInterp,
	recordRemotePose,
	REMOTE_INTERP_DELAY_MS,
	type PoseMirror,
	type RemoteEntry,
} from "@/lib/remoteInterp";
import {ServerClock} from "@/lib/serverClock";
import {replayLocalInputs} from "@/lib/wsClient";
import type {MapRendererInitContext} from "@/pages/useMapRenderer";
import {
	encodeAnimByte,
	type ConnId,
	type DecodedSnapshot,
	type PlayerSnapshot,
	type Profile,
	type ServerProfileChanged,
	type ServerWelcome,
} from "@/protocol";
import {paletteAccent} from "@/sprites/paletteAccent";
import {resolvePaletteSwap} from "@/sprites/palettes";

// the server's authoritative tick rate (HANDOFF locks 30Hz). client mirrors it
// so locally-predicted ticks line up with server ticks 1:1 after the offset.
const SERVER_TICK_HZ = 30;
const SELF_ENTITY_ID = "self";

export type OnlineGameDeps = {
	readonly profile: () => Profile;
	readonly movementInitiallyLearned: boolean;
	readonly onMovementLearned: () => void;
};

// what the game needs from the network layer (TabSyncedClient provides it).
// the game stays ignorant of which browser tab actually owns the socket; it
// only asks whether *this* tab is the one driving the shared avatar.
export type GameNet = {
	recordInput(tick: number, input: CharacterInput): void;
	flushInputs(currentTick: number): void;
	getRecordedInputs(): ReadonlyMap<number, CharacterInput>;
	isController(): boolean;
};

// owns the multiplayer simulation state for one map load: the self character
// + keyboard, the remote roster, the server-tick clock, and the
// welcome/snapshot/join/leave application logic. the page wires WS events
// into the apply* methods and forwards the per-frame step.
export class OnlineGame {
	readonly selfChar: BasicCharacter;
	readonly selfKeyboard: KeyboardInputProvider;
	readonly selfSteer: PointerSteerInputProvider;
	private readonly selfInput: CompositeInputProvider;
	private readonly world: World;
	private readonly renderer: MapRendererInitContext["renderer"];
	private readonly serverClock: ServerClock;
	private readonly tickIntervalMs = 1000 / SERVER_TICK_HZ;
	private readonly remotes = new Map<number, RemoteEntry>();
	private readonly remotesByConnId = new Map<ConnId, RemoteEntry>();
	private readonly chatBubbles = new Map<ConnId, ChatBubble[]>();
	private chatBubblesEnabled = true;
	private nameTagsEnabled = true;
	private readonly deps: OnlineGameDeps;
	private _selfConnId: ConnId | null = null;
	private selfIdIndex: number | null = null;
	private selfSpawned = false;
	private pendingSelfSnap: {x: number; y: number; facing: Direction} | null = null;
	private movementLearned: boolean;
	// touch-primary devices get the hold-to-walk hint instead of the key hint.
	private readonly coarsePointer = hasCoarsePointer();
	// while another tab controls the avatar this tab renders the self character
	// exactly like a remote: interpolated snapshots buffered here, no prediction.
	private readonly selfMirror: PoseMirror;
	private controlling = true;

	constructor(ctx: MapRendererInitContext, deps: OnlineGameDeps) {
		this.deps = deps;
		this.world = ctx.world;
		this.renderer = ctx.renderer;
		this.serverClock = new ServerClock(new GameClock(SERVER_TICK_HZ));
		this.selfKeyboard = new KeyboardInputProvider();
		// a provisional local position only — the welcome's spawn replaces it
		// before the character ever renders (see spawnSelf).
		const spawn = sampleSpawnOrCenter(
			collectSpawnRegions(ctx.map),
			ctx.mapPixelWidth,
			ctx.mapPixelHeight
		);
		const profile = deps.profile();
		this.selfChar = createBasicCharacter({
			id: SELF_ENTITY_ID,
			sprite: resolveAvatarSprite(profile.avatarId),
			paletteSwap: resolvePaletteSwap(profile.paletteId),
			x: spawn.x,
			y: spawn.y,
		});
		this.selfSteer = new PointerSteerInputProvider({
			screenToWorld: ctx.screenToWorld,
			origin: () => collisionCenter(this.selfChar),
		});
		this.selfInput = new CompositeInputProvider([this.selfKeyboard, this.selfSteer]);
		this.selfMirror = {character: this.selfChar, samples: []};
		this.movementLearned = deps.movementInitiallyLearned;
	}

	// suspends/resumes all player input sources (e.g. while a modal is open).
	setInputEnabled(enabled: boolean): void {
		this.selfKeyboard.setEnabled(enabled);
		this.selfSteer.setEnabled(enabled);
	}

	setKeyBindings(bindings: KeyBindings): void {
		this.selfKeyboard.setBindings(bindings);
		// the movement hint teaches the default keys; a player running custom
		// bindings chose them in settings and would only be shown wrong keys.
		if (!this.movementLearned && !sameMovementBindings(bindings, DEFAULT_KEY_BINDINGS)) {
			this.movementLearned = true;
			this.deps.onMovementLearned();
		}
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

	applySnapshot(snap: DecodedSnapshot, net: GameNet): void {
		// re-anchor our server-tick estimate on every snapshot — ratchets up only
		// (see ServerClock.syncToServerTick) so a local stall can't fall behind.
		this.serverClock.syncToServerTick(snap.serverTick);
		const now = performance.now();
		const dtSec = this.tickIntervalMs / 1000;
		for (const pose of snap.poses) {
			if (pose.idIndex === this.selfIdIndex) {
				if (!this.controlling) {
					// another tab drives the avatar; buffer the authoritative
					// pose for interpolation instead of predicting.
					recordRemotePose(this.selfMirror, pose, now);
					continue;
				}
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
					net.getRecordedInputs()
				);
				continue;
			}
			const remote = this.remotes.get(pose.idIndex);
			if (remote) recordRemotePose(remote, pose, now);
		}
	}

	pushChatBubble(senderId: ConnId, text: string): void {
		if (!this.chatBubblesEnabled) return;
		// only a character present in the world can anchor a bubble.
		if (senderId !== this._selfConnId && !this.remotesByConnId.has(senderId)) return;
		let bubbles = this.chatBubbles.get(senderId);
		if (!bubbles) {
			bubbles = [];
			this.chatBubbles.set(senderId, bubbles);
		}
		pushChatBubble(bubbles, text, performance.now());
	}

	setChatBubblesEnabled(enabled: boolean): void {
		this.chatBubblesEnabled = enabled;
		if (!enabled) this.chatBubbles.clear();
	}

	setNameTagsEnabled(enabled: boolean): void {
		this.nameTagsEnabled = enabled;
	}

	applySelfProfile(profile: Profile): void {
		this.selfChar.sprite = resolveAvatarSprite(profile.avatarId);
		this.selfChar.paletteSwap = resolvePaletteSwap(profile.paletteId);
		this.invalidateSelf();
	}

	step(dtMs: number, net: GameNet | null): number {
		this.syncControl(net?.isController() ?? true);
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
			// a welcome resets the interp timeline too; fresh snapshots reseed it.
			this.selfMirror.samples.length = 0;
		}
		this.serverClock.advance(dtMs, (localTick, dtSec) => {
			const inputs = this.world.sampleInputs(localTick, dtSec);
			const selfInput = inputs.get(SELF_ENTITY_ID);
			if (selfInput) net?.recordInput(this.serverClock.serverTickFor(localTick), selfInput);
			this.world.applyInputs(inputs, dtSec);
		});
		const renderAt = performance.now() - REMOTE_INTERP_DELAY_MS;
		for (const r of this.remotes.values()) applyRemoteInterp(r, renderAt);
		if (!this.controlling && this.selfSpawned) applyRemoteInterp(this.selfMirror, renderAt);
		// the net layer gates flushing on being the controller, so tabs never
		// send competing inputs for the same ticks over the shared connection.
		net?.flushInputs(this.serverClock.currentServerTick());
		return this.serverClock.getInterpolationAlpha();
	}

	// prediction only runs on the controlling tab. the others render self via
	// the same snapshot interpolation remotes use — without it the uncontrolled
	// self would snap between authoritative poses at raw snapshot rate.
	private syncControl(controlling: boolean): void {
		if (controlling === this.controlling) return;
		this.controlling = controlling;
		const char = this.selfChar;
		this.selfMirror.samples.length = 0;
		if (controlling) {
			// prediction resumes from wherever interpolation left the character;
			// the next snapshot replay re-anchors it onto authoritative truth.
			char.jump = null;
			char.teleport = null;
			char.jumpOffsetY = 0;
			char.prevJumpOffsetY = 0;
		} else if (this.selfSpawned) {
			// seed interpolation at the current pose so the character holds
			// still until the first buffered snapshot arrives.
			this.selfMirror.samples.push({
				x: char.x,
				y: char.y,
				facing: char.facing,
				walking: char.walking,
				animByte: encodeAnimByte(char.animTimeMs),
				jumpOffset: char.jumpOffsetY,
				at: performance.now(),
			});
		}
	}

	// no follow target until the welcome has actually placed the self
	// character into the world; the renderer keeps the camera wherever it
	// started (handed-off focus or map center) until then.
	followTarget(): BasicCharacter | null {
		return this.selfSpawned ? this.selfChar : null;
	}

	// last known pose of the self character, for handing off to the offline
	// map when switching modes; null until the welcome has placed it.
	selfPose(): {x: number; y: number; facing: Direction} | null {
		if (!this.selfSpawned) return null;
		const {x, y, facing} = this.selfChar;
		return {x, y, facing};
	}

	drawScreenOverlay(
		ctx: CanvasRenderingContext2D,
		alpha: number,
		worldToScreen: (x: number, y: number) => readonly [number, number],
		zoom: number
	): void {
		const textScale = overlayTextScale(zoom);
		this.drawNameTagOverlay(ctx, alpha, worldToScreen, textScale);
		this.drawChatBubbleOverlay(ctx, alpha, worldToScreen, textScale);
		this.drawMovementHintOverlay(ctx, alpha, worldToScreen);
	}

	private drawNameTagOverlay(
		ctx: CanvasRenderingContext2D,
		alpha: number,
		worldToScreen: (x: number, y: number) => readonly [number, number],
		textScale: number
	): void {
		if (!this.nameTagsEnabled) return;
		// a 20-char mono name tops out around 150px wide at scale 1; the tag
		// sits ~20px above the head.
		const cullX = 90 * textScale;
		const cullY = 40 * textScale;
		const draw = (char: BasicCharacter, name: string, color: string) => {
			if (!name) return;
			const [screenX, screenY] = this.headScreenPos(char, alpha, worldToScreen);
			if (
				screenX < -cullX ||
				screenX > window.innerWidth + cullX ||
				screenY <= 0 ||
				screenY > window.innerHeight + cullY
			) {
				return;
			}
			drawNameTag(ctx, name, color, screenX, screenY, textScale);
		};
		for (const r of this.remotesByConnId.values()) draw(r.character, r.profile.name, r.color);
		if (this.selfSpawned) {
			// the server derives a player's color the same way, so the self tag
			// matches what everyone else sees without waiting for a broadcast.
			const profile = this.deps.profile();
			draw(this.selfChar, profile.name, paletteAccent(profile.paletteId));
		}
	}

	private drawChatBubbleOverlay(
		ctx: CanvasRenderingContext2D,
		alpha: number,
		worldToScreen: (x: number, y: number) => readonly [number, number],
		textScale: number
	): void {
		if (this.chatBubbles.size === 0) return;
		const now = performance.now();
		// generous cull margins: the widest bubble half plus the tallest stack
		// keep partially-visible bubbles drawn while skipping far-off characters.
		const cullX = 100 * textScale;
		const cullY = 220 * textScale;
		// bubbles anchor above the name tag when tags are shown.
		const raise = this.nameTagsEnabled ? NAME_TAG_HEIGHT * textScale : 0;
		for (const [connId, bubbles] of this.chatBubbles) {
			pruneChatBubbles(bubbles, now);
			if (bubbles.length === 0) {
				this.chatBubbles.delete(connId);
				continue;
			}
			const char = this.characterFor(connId);
			if (!char) continue;
			const [screenX, screenY] = this.headScreenPos(char, alpha, worldToScreen);
			if (
				screenX < -cullX ||
				screenX > window.innerWidth + cullX ||
				screenY <= 0 ||
				screenY > window.innerHeight + cullY
			) {
				continue;
			}
			drawChatBubbles(ctx, bubbles, screenX, screenY - raise, now, textScale);
		}
	}

	// screen position of the sprite-top center, jump offset applied — the
	// shared anchor for above-head overlays.
	private headScreenPos(
		char: BasicCharacter,
		alpha: number,
		worldToScreen: (x: number, y: number) => readonly [number, number]
	): readonly [number, number] {
		return worldToScreen(
			lerp(char.prevX, char.x, alpha) + char.spriteWidth / 2,
			lerp(char.prevY, char.y, alpha) - lerp(char.prevJumpOffsetY, char.jumpOffsetY, alpha)
		);
	}

	private drawMovementHintOverlay(
		ctx: CanvasRenderingContext2D,
		alpha: number,
		worldToScreen: (x: number, y: number) => readonly [number, number]
	): void {
		if (!this.selfSpawned || this.movementLearned) return;
		const seen = this.selfKeyboard.getSeenKeys();
		// moving by any means retires the hint: a full key set, or a successful
		// hold-to-walk steer (touch, or click-to-move on desktop).
		const learned =
			this.selfSteer.hasSteered() || (!this.coarsePointer && isMovementLearned(seen));
		if (learned) {
			this.movementLearned = true;
			this.deps.onMovementLearned();
			return;
		}
		const [screenX, screenY] = worldToScreen(
			lerp(this.selfChar.prevX, this.selfChar.x, alpha) + this.selfChar.spriteWidth / 2,
			lerp(this.selfChar.prevY, this.selfChar.y, alpha) + this.selfChar.spriteHeight
		);
		if (this.coarsePointer) drawTouchMovementHint(ctx, screenX, screenY, performance.now());
		else drawMovementHint(ctx, screenX, screenY, seen, performance.now());
	}

	private characterFor(connId: ConnId): BasicCharacter | null {
		if (connId === this._selfConnId) return this.selfSpawned ? this.selfChar : null;
		return this.remotesByConnId.get(connId)?.character ?? null;
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
		this.world.addCharacter(this.selfChar, this.selfInput);
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
		this.chatBubbles.delete(connId);
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
