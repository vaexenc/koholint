import ChatPanel from "@/client/components/chat/ChatPanel";
import {useChatPanelState} from "@/client/components/chat/useChatPanelState";
import ConnectionWidget from "@/client/components/hud/ConnectionWidget";
import {SettingsCheckbox} from "@/client/components/hud/SettingsWidget";
import {MapHud} from "@/client/components/map/MapHud";
import {MapShell} from "@/client/components/map/MapShell";
import {useMapSettings} from "@/client/components/map/useMapSettings";
import {useModalGroup} from "@/client/components/map/useModalGroup";
import {ProfileDialog} from "@/client/components/profile/ProfileDialog";
import {useLatestGetter} from "@/client/lib/hooks/useLatestRef";
import {storedBoolean, useLocalStorage} from "@/client/lib/hooks/useLocalStorage";
import {getStored, setStored} from "@/client/lib/safeStorage";
import {spriteFocus, type GameHostContext, type TileClickArgs} from "@/client/session/gameHost";
import {mapGameSetup} from "@/client/session/mapGame";
import type {Mode} from "@/client/session/mode";
import {OnlineGame} from "@/client/session/onlineGame";
import {handOffPlayerPose, takePlayerPose} from "@/client/session/playerPose";
import {randomProfile} from "@/client/session/randomProfile";
import {useGameMirror} from "@/client/session/useGameMirror";
import {useOnlineSession} from "@/client/session/useOnlineSession";
import {
	DEFAULT_CHAT_SETTINGS,
	sanitizeChatSettings,
	type ChatSettings,
} from "@/client/settings/chatSettings";
import {DEFAULT_MAP_URL, useMapRenderer} from "@/client/viewport/useMapRenderer";
import {MAX_VIEW_WORLD_PX, type Profile} from "@/shared/protocol";
import {parseProfile} from "@/shared/protocol/parseProfile";
import {useCallback, useEffect, useRef} from "react";

const LEARNED_MOVEMENT_KEY = "koholint:learnedMovement";
// zoom-in ceiling for everyone but admins — twice the initial camera scale.
const MAX_ZOOM = 6;

type MapPageProps = {
	mapUrl?: string;
	onModeChange: (mode: Mode) => void;
	// the join couldn't be completed; the root route takes over from here.
	onJoinFailed: () => void;
};

// the online map's chrome. everything the server drives — the connection, the
// join lifecycle, the roster and the chat backlog — belongs to useOnlineSession,
// so this is the same shape as its offline counterpart: local preferences, the
// game's construction, and the widgets.
function OnlineMapPage({mapUrl = DEFAULT_MAP_URL, onModeChange, onJoinFailed}: MapPageProps) {
	const [profile, setProfile] = useLocalStorage<Profile>(
		"koholint:profile",
		randomProfile,
		parseProfile
	);
	const settings = useMapSettings("online");
	const modals = useModalGroup();
	const chat = useChatPanelState();
	const [chatBubbles, setChatBubbles] = useLocalStorage(
		"koholint:online.chatBubbles",
		true,
		storedBoolean
	);
	const [nameTags, setNameTags] = useLocalStorage(
		"koholint:online.nameTags",
		true,
		storedBoolean
	);
	const [chatSettings, setChatSettings] = useLocalStorage<ChatSettings>(
		"koholint:chat.settings",
		DEFAULT_CHAT_SETTINGS,
		sanitizeChatSettings
	);

	// the game asks for the profile on its own schedule, so it takes a live
	// getter rather than the value — which also keeps `init` (and with it the
	// whole map load) off the re-run path on every profile edit.
	const getProfile = useLatestGetter(profile);
	const chatInputRef = useRef<HTMLInputElement | null>(null);

	// the live page state the game mirrors.
	const applyOptions = useCallback(
		(game: OnlineGame) => {
			game.controls.setEnabled(!modals.anyOpen);
			game.setKeyBindings(settings.movementBindings);
			game.setChatBubblesEnabled(chatBubbles);
			game.setNameTagsEnabled(nameTags);
		},
		[modals.anyOpen, settings.movementBindings, chatBubbles, nameTags]
	);
	const {
		ref: gameRef,
		attach: attachGame,
		detach: detachGame,
		step,
	} = useGameMirror<OnlineGame>(applyOptions);

	const session = useOnlineSession({
		gameRef,
		profile,
		setProfile,
		obscenityMode: chatSettings.obscenityMode,
		onJoinFailed,
	});
	const net = session.net;

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

	const init = useCallback(
		(ctx: GameHostContext) => {
			const game = new OnlineGame(ctx, {
				profile: getProfile,
				net,
				movementInitiallyLearned: getStored(LEARNED_MOVEMENT_KEY) === "1",
				onMovementLearned: () => setStored(LEARNED_MOVEMENT_KEY, "1"),
			});
			attachGame(game);
			// arriving from offline mode: start the camera where the player
			// stood so the follow spring pans smoothly from there to the
			// server-assigned position. on a fresh load there's no meaningful
			// prior viewpoint — no focus, and the renderer cuts to the player
			// when the welcome places it.
			const from = takePlayerPose(mapUrl);
			return {
				...mapGameSetup(game),
				initialFocus: from ? spriteFocus(game.selfChar, from) : null,
				drawScreenOverlay: game.drawScreenOverlay.bind(game),
				dispose: () => {
					// leaving the page (e.g. switching to offline mode): let the
					// offline map pick up where the player stood.
					const pose = game.selfPose();
					if (pose) handOffPlayerPose(mapUrl, pose);
					detachGame();
				},
			};
		},
		[mapUrl, net, getProfile, attachGame, detachGame]
	);

	const onTileClick = useCallback(
		({worldX, worldY}: TileClickArgs) => {
			if (!session.isAdmin || !settings.clickTeleport) return;
			net.send({type: "teleport", x: worldX, y: worldY});
		},
		[net, session.isAdmin, settings.clickTeleport]
	);

	const {canvasProps, state, playerTile} = useMapRenderer({
		mapUrl,
		// only admins get the follow toggle, so everyone else is pinned to their
		// character — which is also what the server-side interest area assumes.
		follow: settings.follow || !session.isAdmin,
		// the overlay is an admin diagnostic; a stored `true` stays inert for
		// everyone else.
		debug: settings.debug && session.isAdmin,
		insets: chat.insets,
		clickToMove: settings.clickToMove,
		// admins zoom without limit and see every player; everyone else is
		// capped so no viewport can outgrow the server's interest area.
		maxViewWorldPx: session.isAdmin ? null : MAX_VIEW_WORLD_PX,
		maxZoom: session.isAdmin ? null : MAX_ZOOM,
		onViewChange: session.onViewChange,
		init,
		step,
		onTileClick,
	});

	// the join waits on the world being drawable, and the map load is what knows
	// when that is — but it resolves after the session, which the renderer above
	// reads its caps from. so it crosses back as a signal.
	const {onMapDrawable} = session;
	const drawable = state.status === "ok";
	useEffect(() => {
		if (drawable) onMapDrawable();
	}, [drawable, onMapDrawable]);

	const onSendChat = useCallback((text: string) => net.send({type: "chat", text}), [net]);
	const onAvatarPaletteChange = useCallback(
		(avatarId: string, paletteId: string | null) =>
			setProfile((prev) => ({...prev, avatarId, paletteId})),
		[setProfile]
	);

	return (
		<MapShell
			canvasProps={canvasProps}
			state={state}
			loading={!session.joined}
			loadingMessage={session.loadingMessage}
		>
			<ChatPanel
				{...chat.layout}
				messages={session.messages}
				onSend={onSendChat}
				settings={chatSettings}
				onSettingsChange={setChatSettings}
				status={session.status}
				players={session.players}
				inputRef={chatInputRef}
			/>
			<ProfileDialog
				open={modals.profileOpen}
				onOpenChange={modals.setProfileOpen}
				avatarId={profile.avatarId}
				paletteId={profile.paletteId}
				nameField={{
					value: profile.name,
					onChange: session.onNameChange,
					serverError: session.serverNameError,
				}}
				onChange={onAvatarPaletteChange}
			/>
			<MapHud
				profileName={profile.name}
				modals={modals}
				settings={settings}
				playerTile={playerTile}
				reversed={chat.reversed}
				connection={
					<ConnectionWidget
						mode="online"
						onModeChange={onModeChange}
						status={session.status}
						playerCount={session.players.length}
						onReconnect={() => net.connect()}
					/>
				}
				settingsChildren={
					<>
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
					</>
				}
				adminChildren={
					session.isAdmin && (
						<>
							<SettingsCheckbox
								checked={settings.follow}
								onChange={settings.setFollow}
								label="Camera follow"
							/>
							<SettingsCheckbox
								checked={settings.debug}
								onChange={settings.setDebug}
								label="Debug overlay"
							/>
							<SettingsCheckbox
								checked={settings.clickTeleport}
								onChange={settings.setClickTeleport}
								label="Click to teleport"
							/>
						</>
					)
				}
			/>
		</MapShell>
	);
}

export default OnlineMapPage;
