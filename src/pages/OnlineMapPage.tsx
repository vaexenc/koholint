import {AdminBadge} from "@/components/AdminBadge";
import {chatDisplayText, DEFAULT_CHAT_SETTINGS, type ChatSettings} from "@/components/Chat";
import ChatPanel, {
	clampChatWidth,
	clampPlayerListHeight,
	DEFAULT_CHAT_WIDTH,
	DEFAULT_PLAYER_LIST_HEIGHT,
	type PlayerListEntry,
	type UiSide,
} from "@/components/ChatPanel";
import ConnectionWidget, {type Mode} from "@/components/ConnectionWidget";
import {HudBar} from "@/components/HudBar";
import {LoadingScreen} from "@/components/LoadingScreen";
import {PositionWidget} from "@/components/PositionWidget";
import {ProfileDialog} from "@/components/ProfileDialog";
import {ProfileWidget} from "@/components/ProfileWidget";
import {SettingsCheckbox, SettingsWidget} from "@/components/SettingsWidget";
import {readAdminToken} from "@/lib/adminToken";
import {OnlineGame} from "@/lib/onlineGame";
import {handOffPlayerPose, takePlayerPose} from "@/lib/playerPose";
import {randomProfile} from "@/lib/randomProfile";
import {getStored, setStored} from "@/lib/safeStorage";
import {TabSyncedClient} from "@/lib/tabSync";
import {useLatestRef} from "@/lib/useLatestRef";
import {useLocalStorage} from "@/lib/useLocalStorage";
import {useIsSmallScreen} from "@/lib/useMediaQuery";
import {validateName} from "@/lib/validateName";
import {type ConnectionStatus} from "@/lib/wsClient";
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
import {useCallback, useEffect, useMemo, useRef, useState} from "react";

const DEFAULT_MAP_URL = "/maps/overworld-map.json";
const LEARNED_MOVEMENT_KEY = "koholint:learnedMovement";
const CHAT_BUFFER_MAX = 500;

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

function sameProfile(a: Profile, b: Profile): boolean {
	return a.name === b.name && a.avatarId === b.avatarId && a.paletteId === b.paletteId;
}

// the one screen the player sees:
//   preMap → loading (map fetch in flight)
//   joining → loading (ws hello in flight; players auto-join with a random or
//             saved identity, so there's no first-run picker to show)
//   joined → game HUD + chat panel
// a map-load error overlays everything below.
type JoinPhase = {kind: "preMap"} | {kind: "joining"} | {kind: "joined"};

type MapPageProps = {
	mapUrl?: string;
	onModeChange: (mode: Mode) => void;
};

function OnlineMapPage({mapUrl = DEFAULT_MAP_URL, onModeChange}: MapPageProps) {
	const [profile, setProfile] = useLocalStorage<Profile>("koholint:profile", randomProfile);
	const [follow, setFollow] = useLocalStorage("koholint:online.follow", true);
	const [debug, setDebug] = useLocalStorage("koholint:online.debug", false);
	const [clickTeleport, setClickTeleport] = useLocalStorage(
		"koholint:online.clickTeleport",
		true
	);
	const [chatBubbles, setChatBubbles] = useLocalStorage("koholint:online.chatBubbles", true);
	const [nameTags, setNameTags] = useLocalStorage("koholint:online.nameTags", true);
	const [chatSettings, setChatSettings] = useLocalStorage<ChatSettings>(
		"koholint:chat.settings",
		DEFAULT_CHAT_SETTINGS
	);
	const [chatWidth, setChatWidth] = useLocalStorage("koholint:chat.width", DEFAULT_CHAT_WIDTH);
	// on small screens the chat is a full-screen overlay, so it starts hidden
	// there — the map is the first thing a phone user should see.
	const smallScreen = useIsSmallScreen();
	const [chatHidden, setChatHidden] = useState(smallScreen);
	const [storedUiSide, setUiSide] = useLocalStorage<UiSide>("koholint:ui.side", "right");
	// the stored value is untyped json; anything unexpected falls back to right.
	const uiSide: UiSide = storedUiSide === "left" ? "left" : "right";
	const [playerListCollapsed, setPlayerListCollapsed] = useLocalStorage(
		"koholint:chat.playerListCollapsed",
		false
	);
	const [playerListHeight, setPlayerListHeight] = useLocalStorage(
		"koholint:chat.playerListHeight",
		DEFAULT_PLAYER_LIST_HEIGHT
	);

	const [profileOpen, setProfileOpen] = useState(false);
	const [status, setStatus] = useState<ConnectionStatus>("idle");
	const [phase, setPhase] = useState<JoinPhase>({kind: "preMap"});
	const [messages, setMessages] = useState<readonly ChatMessage[]>([]);
	const [players, setPlayers] = useState<ReadonlyMap<ConnId, PlayerListEntry>>(() => new Map());
	const [isAdmin, setIsAdmin] = useState(false);
	const [serverNameError, setServerNameError] = useState<string | undefined>(undefined);

	const profileRef = useLatestRef(profile);
	const chatBubblesRef = useLatestRef(chatBubbles);
	const nameTagsRef = useLatestRef(nameTags);
	const chatSettingsRef = useLatestRef(chatSettings);
	const phaseRef = useLatestRef(phase);
	const profileOpenRef = useLatestRef(profileOpen);
	const gameRef = useRef<OnlineGame | null>(null);
	const wsRef = useRef<TabSyncedClient | null>(null);
	const chatInputRef = useRef<HTMLInputElement | null>(null);

	// pause player movement while the profile dialog is open so its keys
	// (typing, focus nav) don't drive the character. the editable-target guard
	// in KeyboardInputProvider already covers the chat box and name field.
	useEffect(() => {
		gameRef.current?.setKeyboardEnabled(!profileOpen);
	}, [profileOpen]);

	// Enter jumps into the chat input when nothing (map/canvas or the page body)
	// holds focus, so players can start typing without reaching for the mouse.
	// while a real control is focused — the input itself, a widget, the profile
	// dialog — Enter keeps its normal meaning. the input only exists while chat is
	// visible, so a null ref (hidden chat) is a no-op.
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Enter" || e.isComposing || e.defaultPrevented) return;
			const active = document.activeElement;
			const focusFree =
				active === null || active === document.body || active instanceof HTMLCanvasElement;
			if (!focusFree) return;
			const input = chatInputRef.current;
			if (!input) return;
			e.preventDefault();
			input.focus();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	useEffect(() => {
		gameRef.current?.setChatBubblesEnabled(chatBubbles);
	}, [chatBubbles]);

	useEffect(() => {
		gameRef.current?.setNameTagsEnabled(nameTags);
	}, [nameTags]);

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

	const handleProfileChanged = useCallback(
		(msg: ServerProfileChanged) => {
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
			// a change to our own profile means another tab of this identity
			// made the edit; adopt it so this tab's state (and its sprite, via
			// the profile effect) follows. the equality guard stops the
			// setProfile round-trip from ping-ponging with the server.
			if (msg.connId === gameRef.current?.selfConnId) {
				setProfile((prev) => (sameProfile(prev, msg.profile) ? prev : msg.profile));
			}
		},
		[setProfile]
	);

	useEffect(() => {
		const ws = new TabSyncedClient({
			url: buildWsUrl(),
			getProfile: () => profileRef.current,
			getAdminToken: readAdminToken,
		});
		wsRef.current = ws;
		ws.setEvents({
			onStatus: setStatus,
			onWelcome: handleWelcome,
			onSnapshot: (snap) => {
				const ws = wsRef.current;
				if (ws) gameRef.current?.applySnapshot(snap, ws);
			},
			onChat: (m) => {
				setMessages((prev) => appendChat(prev, m));
				if (m.kind === "chat")
					gameRef.current?.pushChatBubble(
						m.senderId,
						chatDisplayText(m, chatSettingsRef.current.obscenityMode)
					);
			},
			onPresence: (m) => setMessages((prev) => appendChat(prev, m)),
			onSystem: (m) => setMessages((prev) => appendChat(prev, m)),
			onJoin: handleJoin,
			onLeave: handleLeave,
			onProfileChanged: handleProfileChanged,
			onProfileRejected: (m) => {
				// a live setProfile rejection during play surfaces the error on
				// the next profile-dialog open. a pre-join rejection (a stale invalid
				// name) is recovered silently: swap in a fresh random name —
				// keeping the chosen avatar/palette — that WsClient then re-sends
				// on its bounded reconnect.
				if (phaseRef.current.kind === "joined") setServerNameError(m.reason);
				else setProfile((prev) => ({...prev, name: randomProfile().name}));
			},
		});
		// the connection is opened by the auto-join effect once the map loads,
		// not here — this effect only constructs the client and wires events.
		return () => {
			ws.disconnect();
			wsRef.current = null;
		};
	}, [
		handleWelcome,
		handleJoin,
		handleLeave,
		handleProfileChanged,
		phaseRef,
		profileRef,
		chatSettingsRef,
		setProfile,
	]);

	// live-apply profile edits, but only after joining. pre-join edits stay
	// local and reach the server via the hello sent on connect.
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
			game.setKeyboardEnabled(!profileOpenRef.current);
			game.setChatBubblesEnabled(chatBubblesRef.current);
			game.setNameTagsEnabled(nameTagsRef.current);
			gameRef.current = game;
			// arriving from offline mode: start the camera where the player
			// stood so the follow spring pans smoothly from there to the
			// server-assigned position. on a fresh load there's no meaningful
			// prior viewpoint — no focus, and the renderer cuts to the player
			// when the welcome places it.
			const from = takePlayerPose(mapUrl);
			return {
				follow: game.followTarget.bind(game),
				initialFocus: from ? {x: from.x, y: from.y} : null,
				drawScreenOverlay: game.drawScreenOverlay.bind(game),
				dispose: () => {
					// leaving the page (e.g. switching to offline mode): let the
					// offline map pick up where the player stood.
					const pose = game.selfPose();
					if (pose) handOffPlayerPose(mapUrl, pose);
					gameRef.current = null;
				},
			};
		},
		[mapUrl, profileRef, profileOpenRef, chatBubblesRef, nameTagsRef]
	);

	const step = useCallback((dtMs: number) => {
		return gameRef.current?.step(dtMs, wsRef.current) ?? 0;
	}, []);

	const onTileClick = useCallback(
		({worldX, worldY}: {worldX: number; worldY: number}) => {
			if (!isAdmin || !clickTeleport) return;
			wsRef.current?.sendTeleport(worldX, worldY);
		},
		[isAdmin, clickTeleport]
	);

	// the stored width is clamped here once; the panel and the camera inset must
	// agree on the same value or the map edge lands under (or short of) the chat.
	// on small screens the panel overlays the whole viewport instead of docking,
	// so the camera keeps the full window.
	const chatPanelWidth = clampChatWidth(chatWidth);
	const chatInset = chatHidden || smallScreen ? 0 : chatPanelWidth;
	// switching the chat side mirrors the bottom cluster: the outer row flips so
	// the dock keeps the far corner, and the pill flips so its contents mirror too.
	const uiReversed = uiSide === "left";

	const {canvasProps, state, playerTile} = useMapRenderer({
		mapUrl,
		follow,
		// the overlay is an admin diagnostic; a stored `true` stays inert for
		// everyone else.
		debug: debug && isAdmin,
		insetLeft: uiSide === "left" ? chatInset : 0,
		insetRight: uiSide === "right" ? chatInset : 0,
		init,
		step,
		onTileClick,
	});

	// resolve the initial phase once the map loads: everyone auto-joins with
	// their saved (or random first-run) identity — there's no first-run picker.
	// a legacy profile with an invalid/empty name gets a fresh random one first.
	// fires at most once because the only transition out of preMap is into joining.
	useEffect(() => {
		if (phase.kind !== "preMap") return;
		if (state.status !== "ok") return;
		if (!validateName(profileRef.current.name).ok) setProfile(randomProfile());
		setPhase({kind: "joining"});
		wsRef.current?.connect();
	}, [phase.kind, state.status, profileRef, setProfile]);

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
			) : phase.kind === "preMap" || phase.kind === "joining" ? (
				<LoadingScreen />
			) : (
				<>
					<ChatPanel
						messages={messages}
						onSend={onSendChat}
						settings={chatSettings}
						onSettingsChange={setChatSettings}
						width={chatPanelWidth}
						onWidthChange={setChatWidth}
						hidden={chatHidden}
						onHiddenChange={setChatHidden}
						side={uiSide}
						onSideChange={setUiSide}
						status={status}
						players={playerList}
						playerListCollapsed={playerListCollapsed}
						onPlayerListCollapsedChange={setPlayerListCollapsed}
						playerListHeight={clampPlayerListHeight(playerListHeight)}
						onPlayerListHeightChange={setPlayerListHeight}
						inputRef={chatInputRef}
					/>
					<ProfileDialog
						open={profileOpen}
						onOpenChange={setProfileOpen}
						avatarId={profile.avatarId}
						paletteId={profile.paletteId}
						name={profile.name}
						onNameChange={onNameChange}
						serverNameError={serverNameError}
						onChange={onAvatarPaletteChange}
					/>
					<HudBar reversed={uiReversed}>
						<ConnectionWidget
							mode="online"
							onModeChange={onModeChange}
							status={status}
							playerCount={playerList.length}
							onReconnect={() => wsRef.current?.connect()}
						/>
						<PositionWidget playerTile={playerTile} />
						<ProfileWidget onOpenProfile={() => setProfileOpen(true)} />
						<SettingsWidget>
							<SettingsCheckbox
								checked={chatBubbles}
								onChange={setChatBubbles}
								label="Chat bubbles"
							/>
							<SettingsCheckbox
								checked={nameTags}
								onChange={setNameTags}
								label="Player names"
							/>
						</SettingsWidget>
						{isAdmin && (
							<AdminBadge>
								<SettingsCheckbox
									checked={follow}
									onChange={setFollow}
									label="Camera follow"
								/>
								<SettingsCheckbox
									checked={debug}
									onChange={setDebug}
									label="Debug overlay"
								/>
								<SettingsCheckbox
									checked={clickTeleport}
									onChange={setClickTeleport}
									label="Click to teleport"
								/>
							</AdminBadge>
						)}
					</HudBar>
				</>
			)}
		</div>
	);
}

export default OnlineMapPage;
