import {AVATARS} from "@/components/avatar-picker/registry";
import {DEFAULT_CHAT_SETTINGS, type ChatSettings} from "@/components/Chat";
import ChatPanel, {type PlayerListEntry} from "@/components/ChatPanel";
import {SettingsDialog} from "@/components/SettingsDialog";
import {Button} from "@/components/ui/button";
import {
	createBasicCharacter,
	GameClock,
	KeyboardInputProvider,
	lerp,
	StaticInputProvider,
	World,
	type BasicCharacter,
} from "@/game";
import {type Direction} from "@/game/types";
import {useLocalStorage} from "@/lib/useLocalStorage";
import {validateName} from "@/lib/validateName";
import {replayLocalInputs, WsClient, type ConnectionStatus} from "@/lib/wsClient";
import {useMapRenderer, type MapRendererInitContext} from "@/pages/useMapRenderer";
import {
	type ChatMessage,
	type ConnId,
	type DecodedSnapshot,
	type PlayerSnapshot,
	type Profile,
	type ServerProfileChanged,
	type ServerWelcome,
	type SnapshotPose,
} from "@/protocol";
import {paletteAccent} from "@/sprites/paletteAccent";
import {PALETTES} from "@/sprites/palettes";
import {ShieldCheck} from "lucide-react";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";

const DEFAULT_MAP_URL = "/maps/overworld.json";
const SELF_ENTITY_ID = "self";
// render remote players this far behind the latest snapshot so we always have
// two frames bracketing the render time. ~1.5x the 66ms snapshot interval.
const REMOTE_INTERP_DELAY_MS = 100;
const ADMIN_TOKEN_KEY = "koholint:admin";

function resolveAvatarSprite(avatarId: string) {
	return (AVATARS.find((a) => a.id === avatarId) ?? AVATARS[0]).sprite;
}

function resolvePaletteSwap(paletteId: string | null) {
	if (!paletteId) return undefined;
	return PALETTES.find((p) => p.id === paletteId)?.palette;
}

function readAdminToken(): string | undefined {
	try {
		return window.localStorage.getItem(ADMIN_TOKEN_KEY) || undefined;
	} catch {
		return undefined;
	}
}

function buildWsUrl(): string {
	const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
	return `${proto}//${window.location.host}/ws`;
}

type RemotePoseSample = {
	x: number;
	y: number;
	facing: Direction;
	walking: boolean;
	animByte: number;
	jumpOffset: number;
	at: number;
};

type RemoteEntry = {
	connId: ConnId;
	idIndex: number;
	profile: Profile;
	color: string;
	character: BasicCharacter;
	// snapshot-interpolation buffer, ascending by `at` (ws delivery is ordered so
	// samples never arrive out of sequence). we render REMOTE_INTERP_DELAY_MS in
	// the past and lerp between whichever pair brackets that render time, so we
	// need more than two samples buffered to cover the delay plus network jitter.
	samples: RemotePoseSample[];
};

// the server's authoritative tick rate (HANDOFF locks 30Hz). client mirrors it
// so locally-predicted ticks line up with server ticks 1:1 after the offset.
const SERVER_TICK_HZ = 30;

// stamp local inputs this many ticks ahead of our estimate of the server's
// current tick. the server consumes an input only when its tick counter
// reaches that exact tick (server/rooms.ts stepOnce), so an input must arrive
// *before* the server gets there. without this lead every input lands in the
// server's past and is dropped, and prediction can never reconcile. 4 ticks
// (~130ms at 30Hz) covers a typical RTT; a tick the lead fails to cover gets
// neutral on the server and is corrected by the next snapshot.
const INPUT_LEAD_TICKS = 4;

// maps our local fixed-step clock onto the server's tick numbering. both run at
// SERVER_TICK_HZ but start at different values and drift, so we carry the
// difference as an offset, biased by INPUT_LEAD_TICKS so the inputs we stamp
// land in the server's near future instead of its past. owns the one invariant
// the prediction path leans on: currentServerTick() is the server tick our
// latest locally-simulated tick maps to.
class ServerClock {
	private offset = 0;
	private readonly clock: GameClock;

	constructor(clock: GameClock) {
		this.clock = clock;
	}

	advance(dtMs: number, step: (localTick: number, dtSec: number) => void): number {
		return this.clock.advance(dtMs, step);
	}

	getInterpolationAlpha(): number {
		return this.clock.getInterpolationAlpha();
	}

	// the server tick a given local tick maps to.
	serverTickFor(localTick: number): number {
		return localTick + this.offset;
	}

	// the server tick our latest locally-simulated tick maps to.
	currentServerTick(): number {
		return this.clock.getCurrentTick() + this.offset;
	}

	// hard re-anchor on welcome: a fresh hello (or a server that restarted its
	// tick counter) resets the offset outright, even downward.
	resetToServerTick(serverTick: number): void {
		this.offset = this.offsetFor(serverTick);
	}

	// per-snapshot re-anchor: ratchet up only. a local dropped-tick stall
	// (clock.advance bailing after a tab freeze) must never let the estimate
	// fall behind the server, or our inputs would land in its past and stop
	// being applied.
	syncToServerTick(serverTick: number): void {
		const wanted = this.offsetFor(serverTick);
		if (wanted > this.offset) this.offset = wanted;
	}

	private offsetFor(serverTick: number): number {
		return serverTick - this.clock.getCurrentTick() + INPUT_LEAD_TICKS;
	}
}

type OnlineGame = {
	world: World;
	serverClock: ServerClock;
	selfChar: BasicCharacter;
	selfKeyboard: KeyboardInputProvider;
	remotes: Map<number, RemoteEntry>;
	remotesByConnId: Map<ConnId, RemoteEntry>;
	tickIntervalMs: number;
	invalidateSelf: () => void;
	invalidateRemote: (connId: ConnId) => void;
	addRemote: (player: PlayerSnapshot) => void;
	removeRemote: (connId: ConnId) => void;
	// queued spawn from welcome / snapshot; applied on the next step once the
	// world + selfChar are guaranteed live. avoids ordering hazards between the
	// async map load (init) and the ws welcome handler.
	pendingSelfSnap: {x: number; y: number; facing: Direction} | null;
};

// how long to retain past samples. must comfortably exceed REMOTE_INTERP_DELAY_MS
// so the buffer always holds a pair bracketing the render time, even when a
// snapshot arrives late.
const REMOTE_SAMPLE_HISTORY_MS = 500;

// positions the remote sprite at renderAt by lerping between the two buffered
// samples that bracket it. consecutive segments share endpoints, so motion is
// continuous regardless of uneven snapshot arrival spacing. clamps (never
// extrapolates) at the buffer ends — before the oldest sample we hold the
// oldest, past the newest we hold the newest — which falls out of the same lerp
// for free once we pick lo === hi and t === 0 for those cases.
function applyRemoteInterp(remote: RemoteEntry, renderAt: number): void {
	const samples = remote.samples;
	if (samples.length === 0) return;
	const char = remote.character;
	// the segment [lo, hi] bracketing renderAt and how far across it we are.
	// default to the newest sample, which covers renderAt past the buffer's end.
	let lo = samples[samples.length - 1];
	let hi = lo;
	let t = 0;
	if (renderAt <= samples[0].at) {
		lo = hi = samples[0]; // before the buffer's start: hold the oldest.
	} else if (renderAt < hi.at) {
		for (let i = 0; i < samples.length - 1; i++) {
			if (renderAt <= samples[i + 1].at) {
				lo = samples[i];
				hi = samples[i + 1];
				const span = hi.at - lo.at;
				t = span > 0 ? (renderAt - lo.at) / span : 0;
				break;
			}
		}
	}
	char.x = char.prevX = lerp(lo.x, hi.x, t);
	char.y = char.prevY = lerp(lo.y, hi.y, t);
	// advance the walk phase smoothly across the segment instead of snapping it
	// at each snapshot. animByte climbs monotonically while walking; a drop means
	// it reset on stop (or saturated at 255), so we hold the newer value rather
	// than interpolate backward through it.
	const animByte = hi.animByte >= lo.animByte ? lerp(lo.animByte, hi.animByte, t) : hi.animByte;
	char.animTimeMs = animByte * 16;
	// lerp the hop arc too so remotes rise/fall smoothly over a hole.
	char.jumpOffsetY = char.prevJumpOffsetY = lerp(lo.jumpOffset, hi.jumpOffset, t);
	// facing/walking come from the sample we're moving toward (the nearest
	// endpoint when clamped).
	char.facing = hi.facing;
	char.walking = hi.walking;
}

function recordRemotePose(remote: RemoteEntry, pose: SnapshotPose, at: number): void {
	const samples = remote.samples;
	samples.push({
		x: pose.x,
		y: pose.y,
		facing: pose.facing,
		walking: pose.walking,
		animByte: pose.animByte,
		jumpOffset: pose.jumpOffset,
		at,
	});
	// evict samples older than the history window, but always keep at least two
	// so there's still a segment to interpolate across.
	const cutoff = at - REMOTE_SAMPLE_HISTORY_MS;
	while (samples.length > 2 && samples[0].at < cutoff) samples.shift();
}

const CHAT_BUFFER_MAX = 500;

function appendChat(prev: readonly ChatMessage[], next: ChatMessage): ChatMessage[] {
	const out =
		prev.length >= CHAT_BUFFER_MAX ? prev.slice(prev.length - CHAT_BUFFER_MAX + 1) : [...prev];
	out.push(next);
	return out;
}

function toPlayerListEntry(p: PlayerSnapshot): PlayerListEntry {
	return {
		connId: p.connId,
		name: p.profile.name,
		color: p.color,
		avatarId: p.profile.avatarId,
		paletteId: p.profile.paletteId,
	};
}

function selfPlayerListEntry(connId: ConnId, profile: Profile): PlayerListEntry {
	return {
		connId,
		name: profile.name,
		color: paletteAccent(profile.paletteId),
		avatarId: profile.avatarId,
		paletteId: profile.paletteId,
	};
}

type MapPageProps = {mapUrl?: string};

function OnlineMapPage({mapUrl = DEFAULT_MAP_URL}: MapPageProps) {
	const [profile, setProfile] = useLocalStorage<Profile>("koholint:profile", {
		name: "",
		avatarId: AVATARS[0].id,
		paletteId: null,
	});
	const [follow, setFollow] = useLocalStorage("koholint:online.follow", false);
	const [chatSettings, setChatSettings] = useLocalStorage<ChatSettings>(
		"koholint:chat.settings",
		DEFAULT_CHAT_SETTINGS
	);
	const [chatWidth, setChatWidth] = useLocalStorage("koholint:chat.width", 356);
	const [playerListCollapsed, setPlayerListCollapsed] = useLocalStorage(
		"koholint:chat.playerListCollapsed",
		false
	);

	const [settingsOpen, setSettingsOpen] = useState(false);
	const [status, setStatus] = useState<ConnectionStatus>("idle");
	const [messages, setMessages] = useState<readonly ChatMessage[]>([]);
	const [players, setPlayers] = useState<ReadonlyMap<ConnId, PlayerListEntry>>(() => new Map());
	const [isAdmin, setIsAdmin] = useState(false);
	const [serverNameError, setServerNameError] = useState<string | undefined>(undefined);

	const profileRef = useRef(profile);
	const gameRef = useRef<OnlineGame | null>(null);
	const wsRef = useRef<WsClient | null>(null);
	const selfConnIdRef = useRef<ConnId | null>(null);
	const selfIdIndexRef = useRef<number | null>(null);
	// welcome may arrive before the map's init runs (or vice versa). buffer the
	// last welcome so whichever side finishes second can apply it.
	const pendingWelcomeRef = useRef<ServerWelcome | null>(null);
	// mirrors settingsOpen for init(), which captures its closure once and would
	// otherwise see a stale value if the dialog is already open at map-load time.
	const settingsOpenRef = useRef(settingsOpen);

	useEffect(() => {
		profileRef.current = profile;
	}, [profile]);

	// pause player movement while the settings/avatar dialog is open so its keys
	// (typing, focus nav) don't drive the character. the editable-target guard in
	// KeyboardInputProvider already covers the chat box and name field.
	useEffect(() => {
		settingsOpenRef.current = settingsOpen;
		gameRef.current?.selfKeyboard.setEnabled(!settingsOpen);
	}, [settingsOpen]);

	useEffect(() => {
		if (!validateName(profile.name).ok) setSettingsOpen(true);
		// run once on mount; subsequent edits open via the Settings button.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const playerList = useMemo(() => [...players.values()], [players]);

	const applyWelcomeToGame = useCallback((msg: ServerWelcome) => {
		const game = gameRef.current;
		if (!game) return;
		game.serverClock.resetToServerTick(msg.serverTick);
		game.pendingSelfSnap = {x: msg.spawn.x, y: msg.spawn.y, facing: "down"};
		for (const r of game.remotesByConnId.values()) game.removeRemote(r.connId);
		const selfId = selfConnIdRef.current;
		for (const p of msg.players) if (p.connId !== selfId) game.addRemote(p);
	}, []);

	const handleWelcome = useCallback(
		(msg: ServerWelcome) => {
			selfConnIdRef.current = msg.connId;
			const selfPlayer = msg.players.find((p) => p.connId === msg.connId) ?? null;
			selfIdIndexRef.current = selfPlayer ? selfPlayer.idIndex : null;
			setIsAdmin(msg.isAdmin);
			setServerNameError(undefined);
			setMessages(msg.chatBacklog.slice(-CHAT_BUFFER_MAX));
			const next = new Map<ConnId, PlayerListEntry>();
			for (const p of msg.players) next.set(p.connId, toPlayerListEntry(p));
			if (!next.has(msg.connId))
				next.set(msg.connId, selfPlayerListEntry(msg.connId, profileRef.current));
			setPlayers(next);
			if (gameRef.current) applyWelcomeToGame(msg);
			else pendingWelcomeRef.current = msg;
		},
		[applyWelcomeToGame]
	);

	const handleJoin = useCallback((player: PlayerSnapshot) => {
		if (player.connId === selfConnIdRef.current) {
			selfIdIndexRef.current = player.idIndex;
			return;
		}
		setPlayers((prev) => {
			const next = new Map(prev);
			next.set(player.connId, toPlayerListEntry(player));
			return next;
		});
		gameRef.current?.addRemote(player);
	}, []);

	const handleLeave = useCallback((connId: ConnId) => {
		setPlayers((prev) => {
			if (!prev.has(connId)) return prev;
			const next = new Map(prev);
			next.delete(connId);
			return next;
		});
		gameRef.current?.removeRemote(connId);
	}, []);

	const handleProfileChanged = useCallback((msg: ServerProfileChanged) => {
		setPlayers((prev) => {
			const next = new Map(prev);
			next.set(msg.connId, {
				connId: msg.connId,
				name: msg.profile.name,
				color: msg.color,
				avatarId: msg.profile.avatarId,
				paletteId: msg.profile.paletteId,
			});
			return next;
		});
		const game = gameRef.current;
		if (!game) return;
		const remote = game.remotesByConnId.get(msg.connId);
		if (!remote) return;
		remote.profile = msg.profile;
		remote.color = msg.color;
		remote.character.sprite = resolveAvatarSprite(msg.profile.avatarId);
		remote.character.paletteSwap = resolvePaletteSwap(msg.profile.paletteId);
		game.invalidateRemote(msg.connId);
	}, []);

	const handleSnapshot = useCallback((snap: DecodedSnapshot) => {
		const game = gameRef.current;
		if (!game) return;
		// re-anchor our server-tick estimate on every snapshot — ratchets up only
		// (see ServerClock.syncToServerTick) so a local stall can't fall behind.
		game.serverClock.syncToServerTick(snap.serverTick);
		const selfIdx = selfIdIndexRef.current;
		const now = performance.now();
		const dtSec = game.tickIntervalMs / 1000;
		for (const pose of snap.poses) {
			if (pose.idIndex === selfIdx) {
				const ws = wsRef.current;
				if (!ws) continue;
				// a jump/teleport is a deterministic, input-locked animation the
				// client and server run identically but offset in time (our
				// prediction leads the server). suspend reconciliation while
				// *either* side is mid-animation: snapping to a mid-hop pose —
				// which sits over a hole, illegal for walking physics — would
				// corrupt the replay and is the hole-hop jitter. the client clears
				// its own jump first (it leads), so pose.jumping covers the tail
				// window where the server is still hopping. reconciliation resumes
				// once both sides land, correcting any residual drift then.
				if (game.selfChar.jump || game.selfChar.teleport || pose.jumping) continue;
				// the pose reflects our inputs applied through snap.ackTickForYou
				// (the last of *our* inputs the server consumed) — not
				// snap.serverTick, which is just the sim's frame counter and runs
				// ahead of our ack. anchoring on serverTick skipped the first
				// un-acked input every snapshot. replay from the ack up to the
				// last tick we've locally simulated (currentServerTick - 1) to
				// rebuild the prediction on top of authoritative truth.
				const currentServerTick = game.serverClock.currentServerTick();
				replayLocalInputs(
					game.world,
					game.selfChar,
					pose,
					snap.ackTickForYou,
					currentServerTick - 1,
					dtSec,
					ws.getRecordedInputs()
				);
				continue;
			}
			const remote = game.remotes.get(pose.idIndex);
			if (remote) recordRemotePose(remote, pose, now);
		}
	}, []);

	useEffect(() => {
		const ws = new WsClient({
			url: buildWsUrl(),
			getProfile: () => profileRef.current,
			getAdminToken: readAdminToken,
		});
		wsRef.current = ws;
		ws.setEvents({
			onStatus: setStatus,
			onWelcome: handleWelcome,
			onSnapshot: handleSnapshot,
			onChat: (m) => setMessages((prev) => appendChat(prev, m)),
			onPresence: (m) => setMessages((prev) => appendChat(prev, m)),
			onSystem: (m) => setMessages((prev) => appendChat(prev, m)),
			onJoin: handleJoin,
			onLeave: handleLeave,
			onProfileChanged: handleProfileChanged,
			onProfileRejected: (m) => setServerNameError(m.reason),
		});
		ws.connect();
		return () => {
			ws.disconnect();
			wsRef.current = null;
		};
	}, [handleWelcome, handleSnapshot, handleJoin, handleLeave, handleProfileChanged]);

	useEffect(() => {
		if (!validateName(profile.name).ok) return;
		setServerNameError(undefined);
		wsRef.current?.sendSetProfile(profile);
		const game = gameRef.current;
		if (game) {
			game.selfChar.sprite = resolveAvatarSprite(profile.avatarId);
			game.selfChar.paletteSwap = resolvePaletteSwap(profile.paletteId);
			game.invalidateSelf();
		}
		const selfId = selfConnIdRef.current;
		if (!selfId) return;
		setPlayers((prev) => {
			const next = new Map(prev);
			next.set(selfId, selfPlayerListEntry(selfId, profile));
			return next;
		});
	}, [profile]);

	const init = useCallback(
		(ctx: MapRendererInitContext) => {
			const {world, renderer, mapPixelWidth, mapPixelHeight} = ctx;
			const serverClock = new ServerClock(new GameClock(SERVER_TICK_HZ));
			const selfKeyboard = new KeyboardInputProvider();
			// honor a dialog that's already open when the map finishes loading.
			selfKeyboard.setEnabled(!settingsOpenRef.current);
			const selfChar = createBasicCharacter({
				id: SELF_ENTITY_ID,
				sprite: resolveAvatarSprite(profileRef.current.avatarId),
				paletteSwap: resolvePaletteSwap(profileRef.current.paletteId),
				x: mapPixelWidth / 2 - 8,
				y: mapPixelHeight / 2 - 8,
			});
			world.addCharacter(selfChar, selfKeyboard);
			const invalidateSelf = () => {
				renderer.invalidate(selfChar.id);
				renderer.ensureLoaded([selfChar]).catch(() => {});
			};
			const remotes = new Map<number, RemoteEntry>();
			const remotesByConnId = new Map<ConnId, RemoteEntry>();
			const addRemote = (player: PlayerSnapshot) => {
				if (remotesByConnId.has(player.connId)) return;
				const char = createBasicCharacter({
					id: `remote:${player.connId}`,
					sprite: resolveAvatarSprite(player.profile.avatarId),
					paletteSwap: resolvePaletteSwap(player.profile.paletteId),
					x: player.x,
					y: player.y,
					facing: player.facing,
				});
				world.addCharacter(char, new StaticInputProvider());
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
				remotes.set(player.idIndex, entry);
				remotesByConnId.set(player.connId, entry);
				renderer.ensureLoaded([char]).catch(() => {});
			};
			const removeRemote = (connId: ConnId) => {
				const r = remotesByConnId.get(connId);
				if (!r) return;
				remotes.delete(r.idIndex);
				remotesByConnId.delete(connId);
				world.removeCharacter(r.character.id);
			};
			const invalidateRemote = (connId: ConnId) => {
				const r = remotesByConnId.get(connId);
				if (!r) return;
				renderer.invalidate(r.character.id);
				renderer.ensureLoaded([r.character]).catch(() => {});
			};
			gameRef.current = {
				world,
				serverClock,
				selfChar,
				selfKeyboard,
				remotes,
				remotesByConnId,
				tickIntervalMs: 1000 / SERVER_TICK_HZ,
				invalidateSelf,
				invalidateRemote,
				addRemote,
				removeRemote,
				pendingSelfSnap: null,
			};
			const pending = pendingWelcomeRef.current;
			if (pending) {
				pendingWelcomeRef.current = null;
				applyWelcomeToGame(pending);
			}
			return {
				follow: () => selfChar,
				dispose: () => {
					gameRef.current = null;
				},
			};
		},
		[applyWelcomeToGame]
	);

	const step = useCallback((dtMs: number) => {
		const game = gameRef.current;
		if (!game) return 0;
		if (game.pendingSelfSnap) {
			const snap = game.pendingSelfSnap;
			game.pendingSelfSnap = null;
			game.selfChar.x = snap.x;
			game.selfChar.y = snap.y;
			game.selfChar.prevX = snap.x;
			game.selfChar.prevY = snap.y;
			game.selfChar.facing = snap.facing;
			game.selfChar.walking = false;
			game.selfChar.jump = null;
			game.selfChar.teleport = null;
			game.selfChar.jumpOffsetY = 0;
			game.selfChar.prevJumpOffsetY = 0;
		}
		const ws = wsRef.current;
		game.serverClock.advance(dtMs, (localTick, dtSec) => {
			const inputs = game.world.sampleInputs(localTick, dtSec);
			const selfInput = inputs.get(SELF_ENTITY_ID);
			if (selfInput) ws?.recordInput(game.serverClock.serverTickFor(localTick), selfInput);
			game.world.applyInputs(inputs, dtSec);
		});
		const renderAt = performance.now() - REMOTE_INTERP_DELAY_MS;
		for (const r of game.remotes.values()) applyRemoteInterp(r, renderAt);
		ws?.flushInputs(game.serverClock.currentServerTick());
		return game.serverClock.getInterpolationAlpha();
	}, []);

	const onTileClick = useCallback(
		({worldX, worldY}: {worldX: number; worldY: number}) => {
			if (!isAdmin) return;
			wsRef.current?.sendTeleport(worldX, worldY);
		},
		[isAdmin]
	);

	const {canvasProps, state, zoom, cursor} = useMapRenderer({
		mapUrl,
		follow,
		debug: false,
		init,
		step,
		onTileClick,
	});

	const map = state.status === "ok" ? state.map : null;
	const tileX = map && cursor ? Math.floor(cursor.x / map.tilewidth) : null;
	const tileY = map && cursor ? Math.floor(cursor.y / map.tileheight) : null;
	const onSendChat = useCallback((text: string) => wsRef.current?.sendChat(text), []);
	const onNameChange = useCallback(
		(name: string) => setProfile((prev) => ({...prev, name})),
		[setProfile]
	);
	const onAvatarPaletteChange = useCallback(
		(avatarId: string, paletteId: string | null) =>
			setProfile((prev) => ({...prev, avatarId, paletteId})),
		[setProfile]
	);

	return (
		<div className="fixed inset-0 overflow-hidden bg-neutral-900 font-mono">
			<canvas {...canvasProps} />
			<div className="absolute top-2 left-2 rounded bg-black/70 p-3 text-xs text-neutral-100 shadow-lg backdrop-blur">
				{state.status === "loading" && <p>loading map…</p>}
				{state.status === "error" && (
					<pre className="whitespace-pre-wrap text-red-400">{state.message}</pre>
				)}
				<div className="flex flex-col gap-2">
					{isAdmin && (
						<div className="flex items-center gap-1.5 self-start rounded bg-amber-400/15 px-2 py-1 text-amber-300 ring-1 ring-inset ring-amber-400/30">
							<ShieldCheck className="h-3.5 w-3.5 shrink-0" />
							<span className="font-semibold">admin</span>
							<span className="text-amber-200/70">· click tile to teleport</span>
						</div>
					)}
					<label className="flex items-center gap-2">
						<input
							type="checkbox"
							checked={follow}
							onChange={(e) => setFollow(e.target.checked)}
						/>
						follow player (wasd / arrows)
					</label>
					<SettingsDialog
						open={settingsOpen}
						onOpenChange={setSettingsOpen}
						avatarId={profile.avatarId}
						paletteId={profile.paletteId}
						name={profile.name}
						onNameChange={onNameChange}
						serverNameError={serverNameError}
						onChange={onAvatarPaletteChange}
						trigger={
							<Button size="sm" variant="secondary">
								Settings
							</Button>
						}
					/>
				</div>
				<div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 tabular-nums">
					<span className="text-neutral-400">zoom</span>
					<span>{zoom.toFixed(2)}x</span>
					<span className="text-neutral-400">pixel</span>
					<span>{cursor ? `${Math.floor(cursor.x)}, ${Math.floor(cursor.y)}` : "—"}</span>
					<span className="text-neutral-400">tile</span>
					<span>{tileX !== null && tileY !== null ? `${tileX}, ${tileY}` : "—"}</span>
				</div>
			</div>
			<ChatPanel
				messages={messages}
				onSend={onSendChat}
				settings={chatSettings}
				onSettingsChange={setChatSettings}
				initialWidth={chatWidth}
				onWidthChange={setChatWidth}
				status={status}
				players={playerList}
				playerListCollapsed={playerListCollapsed}
				onPlayerListCollapsedChange={setPlayerListCollapsed}
			/>
		</div>
	);
}

export default OnlineMapPage;
