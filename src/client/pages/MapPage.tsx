import ConnectionWidget from "@/client/components/hud/ConnectionWidget";
import {SettingsCheckbox} from "@/client/components/hud/SettingsWidget";
import {MapHud} from "@/client/components/map/MapHud";
import {MapShell} from "@/client/components/map/MapShell";
import {useMapSettings} from "@/client/components/map/useMapSettings";
import {useModalGroup} from "@/client/components/map/useModalGroup";
import {ProfileDialog} from "@/client/components/profile/ProfileDialog";
import {hasAdminToken} from "@/client/lib/adminToken";
import {useLatestGetter} from "@/client/lib/hooks/useLatestRef";
import {useLocalStorage} from "@/client/lib/hooks/useLocalStorage";
import {spriteFocus, type GameHostContext, type TileClickArgs} from "@/client/session/gameHost";
import {mapGameSetup} from "@/client/session/mapGame";
import type {Mode} from "@/client/session/mode";
import type {ConnectionError} from "@/client/session/net/wsClient";
import {OfflineGame} from "@/client/session/offlineGame";
import {
	handOffPlayerPose,
	persistPoseUntilExit,
	takeArrivalPose,
} from "@/client/session/playerPose";
import {randomProfile} from "@/client/session/randomProfile";
import {useGameMirror} from "@/client/session/useGameMirror";
import {DEFAULT_MAP_URL, useMapRenderer} from "@/client/viewport/useMapRenderer";
import type {Profile} from "@/shared/protocol";
import {parseProfile} from "@/shared/protocol/parseProfile";
import {useCallback, useEffect, useState} from "react";

type MapPageProps = {
	mapUrl?: string;
	// set on the root route, where the connection pill switches back online;
	// the standalone test map passes nothing and gets no pill.
	onModeChange?: (mode: Mode) => void;
	// true while this page is standing in for a failed online join and the root
	// route is still probing the server, so the pill says so instead of reading
	// as a deliberate "offline".
	reconnecting?: boolean;
	// what went wrong with that join, for the pill's hover. only meaningful while
	// reconnecting.
	connectionError?: ConnectionError | null;
	// on the root route teleporting is an admin power (online only), so the
	// offline page there gets neither the feature nor the toggle; the test map
	// opts in for everyone.
	allowTeleport?: boolean;
	// localStorage namespace for the settings toggles, so routes sharing this
	// page (root offline, test map) persist them independently.
	settingsScope?: string;
	// localStorage key for the profile. defaults to the shared root slot the
	// online page also uses, so identity carries across mode switches on the
	// root route; other routes (test map) pass their own to stay isolated.
	profileKey?: string;
};

function MapPage({
	mapUrl = DEFAULT_MAP_URL,
	onModeChange,
	reconnecting = false,
	connectionError = null,
	allowTeleport = false,
	settingsScope = "map",
	profileKey = "koholint:profile",
}: MapPageProps) {
	const settings = useMapSettings(settingsScope);
	const modals = useModalGroup();
	// offline only renders avatar/palette; the name rides along untouched.
	const [profile, setProfile] = useLocalStorage<Profile>(profileKey, randomProfile, parseProfile);
	const [isAdmin] = useState(hasAdminToken);

	// the game asks for the profile on its own schedule — once at construction,
	// again whenever it re-applies the local appearance — so it takes a live
	// getter rather than the value. that also keeps `init` (and with it the whole
	// map load) off the re-run path on every profile edit.
	const getProfile = useLatestGetter(profile);

	// the live page state the game mirrors.
	const applyOptions = useCallback(
		(game: OfflineGame) => {
			game.controls.setEnabled(!modals.anyOpen);
			game.setKeyBindings(settings.movementBindings);
		},
		[modals.anyOpen, settings.movementBindings]
	);
	const {
		ref: gameRef,
		attach: attachGame,
		detach: detachGame,
		step,
	} = useGameMirror<OfflineGame>(applyOptions);

	const init = useCallback(
		(ctx: GameHostContext) => {
			const game = new OfflineGame(ctx, {
				profile: getProfile,
				pose: takeArrivalPose(mapUrl, ctx),
			});
			attachGame(game);
			// covers both ways out of the map — this dispose, and a reload or tab
			// close that skips react cleanup entirely.
			const stopPersisting = persistPoseUntilExit(mapUrl, () => game.selfPose());
			return {
				...mapGameSetup(game),
				initialFocus: spriteFocus(game.followTarget()),
				dispose: () => {
					// leaving the page: the online map starts its camera on this
					// pose after a mode switch, storage restores it next session.
					handOffPlayerPose(mapUrl, game.selfPose());
					stopPersisting();
					detachGame();
				},
			};
		},
		[mapUrl, getProfile, attachGame, detachGame]
	);

	const onTileClick = useCallback(
		({worldX, worldY}: TileClickArgs) => {
			if (!allowTeleport || !settings.clickTeleport) return;
			gameRef.current?.teleportTo(worldX, worldY);
		},
		[allowTeleport, settings.clickTeleport, gameRef]
	);

	const {canvasProps, state, playerTile} = useMapRenderer({
		mapUrl,
		follow: settings.follow,
		// the overlay is an admin diagnostic; a stored `true` stays inert for
		// everyone else.
		debug: settings.debug && isAdmin,
		clickToMove: settings.clickToMove,
		// nothing overlays the map offline, and there is no server whose interest
		// area the zoom has to stay inside.
		insets: {left: 0, right: 0},
		maxViewWorldPx: null,
		maxZoom: null,
		init,
		step,
		onTileClick,
	});

	// push the latest avatar/palette selection onto the character and make sure
	// its sheet is loaded. gated on state.status so the first apply happens
	// after the hook's init has populated gameRef.
	useEffect(() => {
		if (state.status !== "ok") return;
		gameRef.current?.applySelfProfile(profile);
	}, [profile, state.status, gameRef]);

	return (
		<MapShell canvasProps={canvasProps} state={state} loading={state.status === "loading"}>
			<ProfileDialog
				open={modals.profileOpen}
				onOpenChange={modals.setProfileOpen}
				avatarId={profile.avatarId}
				paletteId={profile.paletteId}
				onChange={(avatarId, paletteId) =>
					setProfile((prev) => ({...prev, avatarId, paletteId}))
				}
			/>
			<MapHud
				profileName={profile.name}
				modals={modals}
				settings={settings}
				playerTile={playerTile}
				connection={
					onModeChange && (
						<ConnectionWidget
							mode="offline"
							onModeChange={onModeChange}
							status={reconnecting ? "resuming" : "idle"}
							playerCount={0}
							error={reconnecting ? connectionError : null}
						/>
					)
				}
				settingsChildren={
					<>
						<SettingsCheckbox
							checked={settings.follow}
							onChange={settings.setFollow}
							label="Camera follow"
						/>
						{allowTeleport && (
							<SettingsCheckbox
								checked={settings.clickTeleport}
								onChange={settings.setClickTeleport}
								label="Click to teleport"
							/>
						)}
					</>
				}
				adminChildren={
					isAdmin && (
						<SettingsCheckbox
							checked={settings.debug}
							onChange={settings.setDebug}
							label="Debug overlay"
						/>
					)
				}
			/>
		</MapShell>
	);
}

export default MapPage;
