import {AVATARS} from "@/components/avatar-picker/registry";
import {DEFAULT_CHAT_SETTINGS, type ChatSettings} from "@/components/Chat";
import ChatPanel, {type PlayerListEntry} from "@/components/ChatPanel";
import {JoinGate} from "@/components/JoinGate";
import {LoadingScreen} from "@/components/LoadingScreen";
import {SettingsDialog} from "@/components/SettingsDialog";
import {Button} from "@/components/ui/button";
import {OnlineGame} from "@/lib/onlineGame";
import {getStored, setStored} from "@/lib/safeStorage";
import {useLatestRef} from "@/lib/useLatestRef";
import {useLocalStorage} from "@/lib/useLocalStorage";
import {validateName} from "@/lib/validateName";
import {RESUME_TOKEN_KEY, WsClient, type ConnectionStatus} from "@/lib/wsClient";
import {useMapRenderer, type MapRendererInitContext} from "@/pages/useMapRenderer";
import {
	type ChatMessage,
	type ConnId,
	type PlayerSnapshot,
	type Profile,
	type ServerProfileChanged,
	type ServerWelcome,
} from "@/protocol";
import {paletteAccent} from "@/sprites/paletteAccent";
import {ShieldCheck} from "lucide-react";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";

const DEFAULT_MAP_URL = "/maps/overworld.json";
const ADMIN_TOKEN_KEY = "koholint:admin";
const LEARNED_MOVEMENT_KEY = "koholint:learnedMovement";
const CHAT_BUFFER_MAX = 500;

function readAdminToken(): string | undefined {
	return getStored(ADMIN_TOKEN_KEY) || undefined;
}

// a resume token means this browser has connected before: a returning player.
// they skip the join gate and auto-connect with their saved profile; only
// brand-new players see the avatar picker + Join button.
function hasResumeToken(): boolean {
	return Boolean(getStored(RESUME_TOKEN_KEY));
}

function buildWsUrl(): string {
	const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
	return `${proto}//${window.location.host}/ws`;
}

function appendChat(prev: readonly ChatMessage[], next: ChatMessage): ChatMessage[] {
	return [...prev, next].slice(-CHAT_BUFFER_MAX);
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

// the one screen the player sees:
//   preMap → loading (map fetch in flight)
//   autoJoining → loading (returning player, ws hello in flight)
//   gate → JoinGate (first-run, or fallback after a rejected hello)
//   joined → game HUD + chat panel
// a map-load error overlays everything below.
type JoinPhase =
	| {kind: "preMap"}
	| {kind: "autoJoining"}
	| {kind: "gate"; joining: boolean}
	| {kind: "joined"};

type MapPageProps = {mapUrl?: string};

function OnlineMapPage({mapUrl = DEFAULT_MAP_URL}: MapPageProps) {
	const [profile, setProfile] = useLocalStorage<Profile>("koholint:profile", {
		name: "",
		avatarId: AVATARS[0].id,
		paletteId: null,
	});
	const [follow, setFollow] = useLocalStorage("koholint:online.follow", true);
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
	const [phase, setPhase] = useState<JoinPhase>({kind: "preMap"});
	const [messages, setMessages] = useState<readonly ChatMessage[]>([]);
	const [players, setPlayers] = useState<ReadonlyMap<ConnId, PlayerListEntry>>(() => new Map());
	const [isAdmin, setIsAdmin] = useState(false);
	const [serverNameError, setServerNameError] = useState<string | undefined>(undefined);

	const profileRef = useLatestRef(profile);
	const phaseRef = useLatestRef(phase);
	const settingsOpenRef = useLatestRef(settingsOpen);
	const gameRef = useRef<OnlineGame | null>(null);
	const wsRef = useRef<WsClient | null>(null);

	// pause player movement while the settings/avatar dialog is open so its keys
	// (typing, focus nav) don't drive the character. the editable-target guard
	// in KeyboardInputProvider already covers the chat box and name field.
	useEffect(() => {
		gameRef.current?.setKeyboardEnabled(!settingsOpen);
	}, [settingsOpen]);

	const playerList = useMemo(() => [...players.values()], [players]);

	const handleWelcome = useCallback(
		(msg: ServerWelcome) => {
			const game = gameRef.current;
			if (!game) return;
			setIsAdmin(msg.isAdmin);
			setServerNameError(undefined);
			setMessages(msg.chatBacklog.slice(-CHAT_BUFFER_MAX));
			const next = new Map<ConnId, PlayerListEntry>();
			for (const p of msg.players) next.set(p.connId, toPlayerListEntry(p));
			if (!next.has(msg.connId))
				next.set(msg.connId, selfPlayerListEntry(msg.connId, profileRef.current));
			setPlayers(next);
			game.applyWelcome(msg);
			setPhase({kind: "joined"});
		},
		[profileRef]
	);

	const handleJoin = useCallback((player: PlayerSnapshot) => {
		const game = gameRef.current;
		if (!game) return;
		const isSelf = player.connId === game.selfConnId;
		game.applyJoin(player);
		if (isSelf) return;
		setPlayers((prev) => {
			const next = new Map(prev);
			next.set(player.connId, toPlayerListEntry(player));
			return next;
		});
	}, []);

	const handleLeave = useCallback((connId: ConnId) => {
		setPlayers((prev) => {
			if (!prev.has(connId)) return prev;
			const next = new Map(prev);
			next.delete(connId);
			return next;
		});
		gameRef.current?.applyLeave(connId);
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
		gameRef.current?.applyProfileChanged(msg);
	}, []);

	useEffect(() => {
		const ws = new WsClient({
			url: buildWsUrl(),
			getProfile: () => profileRef.current,
			getAdminToken: readAdminToken,
		});
		wsRef.current = ws;
		ws.setEvents({
			onStatus: (s) => {
				setStatus(s);
				// a terminal close (e.g. the server rejecting the hello name)
				// ends an in-flight join; surface the gate so the player can
				// fix the name and try again.
				if (s !== "closed") return;
				const cur = phaseRef.current;
				if (cur.kind === "autoJoining" || (cur.kind === "gate" && cur.joining))
					setPhase({kind: "gate", joining: false});
			},
			onWelcome: handleWelcome,
			onSnapshot: (snap) => {
				const ws = wsRef.current;
				if (ws) gameRef.current?.applySnapshot(snap, ws);
			},
			onChat: (m) => setMessages((prev) => appendChat(prev, m)),
			onPresence: (m) => setMessages((prev) => appendChat(prev, m)),
			onSystem: (m) => setMessages((prev) => appendChat(prev, m)),
			onJoin: handleJoin,
			onLeave: handleLeave,
			onProfileChanged: handleProfileChanged,
			onProfileRejected: (m) => {
				setServerNameError(m.reason);
				// a live setProfile rejection during play just surfaces the
				// error on the next dialog open; only an auto-join / Join-press
				// rejection routes the player back to the gate.
				if (phaseRef.current.kind !== "joined") setPhase({kind: "gate", joining: false});
			},
		});
		// the connection is opened on Join press or auto-join — not here:
		// the hello carries the player's profile, so connecting before they
		// pick one would drop us into the world without an identity.
		return () => {
			ws.disconnect();
			wsRef.current = null;
		};
	}, [handleWelcome, handleJoin, handleLeave, handleProfileChanged, phaseRef, profileRef]);

	const onJoin = useCallback(() => {
		if (!validateName(profileRef.current.name).ok) return;
		setServerNameError(undefined);
		setPhase({kind: "gate", joining: true});
		wsRef.current?.connect();
	}, [profileRef]);

	// live-apply profile edits, but only after joining. pre-join edits stay
	// local (the gate previews them) and reach the server via the hello on Join.
	useEffect(() => {
		if (phaseRef.current.kind !== "joined") return;
		if (!validateName(profile.name).ok) return;
		wsRef.current?.sendSetProfile(profile);
		const game = gameRef.current;
		if (!game) return;
		game.applySelfProfile(profile);
		const selfId = game.selfConnId;
		if (!selfId) return;
		setPlayers((prev) => {
			const next = new Map(prev);
			next.set(selfId, selfPlayerListEntry(selfId, profile));
			return next;
		});
	}, [profile, phaseRef]);

	const init = useCallback(
		(ctx: MapRendererInitContext) => {
			const game = new OnlineGame(ctx, {
				profile: () => profileRef.current,
				movementInitiallyLearned: getStored(LEARNED_MOVEMENT_KEY) === "1",
				onMovementLearned: () => setStored(LEARNED_MOVEMENT_KEY, "1"),
			});
			// honor a dialog already open when the map finishes loading.
			game.setKeyboardEnabled(!settingsOpenRef.current);
			gameRef.current = game;
			return {
				follow: () => game.followTarget(),
				initialFocus: {x: game.spawn.x, y: game.spawn.y},
				drawWorldOverlay: (ctx: CanvasRenderingContext2D, alpha: number) =>
					game.drawWorldOverlay(ctx, alpha),
				dispose: () => {
					gameRef.current = null;
				},
			};
		},
		[profileRef, settingsOpenRef]
	);

	const step = useCallback((dtMs: number) => {
		return gameRef.current?.step(dtMs, wsRef.current) ?? 0;
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

	// resolve the initial phase once the map loads: returning players (resume
	// token + valid name) auto-connect; otherwise the gate appears for a
	// first-run or invalid-name fallback. fires at most once because the only
	// transition out of preMap is into autoJoining or gate.
	useEffect(() => {
		if (phase.kind !== "preMap") return;
		if (state.status !== "ok") return;
		if (hasResumeToken() && validateName(profileRef.current.name).ok) {
			setPhase({kind: "autoJoining"});
			wsRef.current?.connect();
		} else {
			setPhase({kind: "gate", joining: false});
		}
	}, [phase.kind, state.status, profileRef]);

	const map = state.status === "ok" ? state.map : null;
	const tileX = map && cursor ? Math.floor(cursor.x / map.tilewidth) : null;
	const tileY = map && cursor ? Math.floor(cursor.y / map.tileheight) : null;
	const onSendChat = useCallback((text: string) => wsRef.current?.sendChat(text), []);
	const onNameChange = useCallback(
		(name: string) => {
			setProfile((prev) => ({...prev, name}));
			// editing the name clears any stale server rejection of the previous
			// one — the new name is a fresh attempt, not the rejected value.
			setServerNameError(undefined);
		},
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

			{state.status === "error" ? (
				<div className="absolute inset-0 grid place-items-center p-4">
					<pre className="max-w-full whitespace-pre-wrap text-xs text-red-400">
						{state.message}
					</pre>
				</div>
			) : phase.kind === "preMap" || phase.kind === "autoJoining" ? (
				<LoadingScreen />
			) : phase.kind === "gate" ? (
				<JoinGate
					name={profile.name}
					onNameChange={onNameChange}
					serverNameError={serverNameError}
					avatarId={profile.avatarId}
					paletteId={profile.paletteId}
					onChange={onAvatarPaletteChange}
					onJoin={onJoin}
					joining={phase.joining}
				/>
			) : (
				<>
					<div className="absolute top-2 left-2 rounded bg-black/70 p-3 text-xs text-neutral-100 shadow-lg backdrop-blur">
						<div className="flex flex-col gap-2">
							{isAdmin && (
								<div className="flex items-center gap-1.5 self-start rounded bg-amber-400/15 px-2 py-1 text-amber-300 ring-1 ring-inset ring-amber-400/30">
									<ShieldCheck className="h-3.5 w-3.5 shrink-0" />
									<span className="font-semibold">admin</span>
									<span className="text-amber-200/70">
										· click tile to teleport
									</span>
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
							<span>
								{cursor ? `${Math.floor(cursor.x)}, ${Math.floor(cursor.y)}` : "—"}
							</span>
							<span className="text-neutral-400">tile</span>
							<span>
								{tileX !== null && tileY !== null ? `${tileX}, ${tileY}` : "—"}
							</span>
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
				</>
			)}
		</div>
	);
}

export default OnlineMapPage;
