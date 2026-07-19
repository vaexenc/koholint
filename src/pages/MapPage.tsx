import {AdminBadge} from "@/components/AdminBadge";
import {resolveAvatarSprite} from "@/components/avatar-picker/registry";
import ConnectionWidget, {type Mode} from "@/components/ConnectionWidget";
import {HudBar} from "@/components/HudBar";
import {LoadingScreen} from "@/components/LoadingScreen";
import {PositionWidget} from "@/components/PositionWidget";
import {ProfileDialog} from "@/components/ProfileDialog";
import {ProfileWidget} from "@/components/ProfileWidget";
import {SettingsCheckbox, SettingsWidget} from "@/components/SettingsWidget";
import {
	collectSpawnRegions,
	createBasicCharacter,
	DEFAULT_TICK_RATE_HZ,
	GameClock,
	KeyboardInputProvider,
	resolveCharacterCollision,
	sampleSpawnOrCenter,
	type BasicCharacter,
	type World,
} from "@/game";
import {hasAdminToken} from "@/lib/adminToken";
import {handOffPlayerPose, loadPlayerPose, savePlayerPose, takePlayerPose} from "@/lib/playerPose";
import {randomProfile} from "@/lib/randomProfile";
import {useLatestRef} from "@/lib/useLatestRef";
import {useLocalStorage} from "@/lib/useLocalStorage";
import {useMapRenderer, type MapRendererInitContext} from "@/pages/useMapRenderer";
import type {Profile} from "@/protocol";
import {resolvePaletteSwap} from "@/sprites/palettes";
import {useCallback, useEffect, useRef, useState} from "react";

const DEFAULT_MAP_URL = "/maps/overworld-map.json";
const PLAYER_CHARACTER_ID = "player-link";

type MapPageProps = {
	mapUrl?: string;
	// set on the root route, where the connection pill switches back online;
	// the standalone test map passes nothing and gets no pill.
	onModeChange?: (mode: Mode) => void;
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

type OfflineGame = {
	world: World;
	clock: GameClock;
	player: BasicCharacter;
	invalidatePlayer: () => void;
};

function MapPage({
	mapUrl = DEFAULT_MAP_URL,
	onModeChange,
	allowTeleport = false,
	settingsScope = "map",
	profileKey = "koholint:profile",
}: MapPageProps) {
	const [debug, setDebug] = useLocalStorage(`koholint:${settingsScope}.debug`, false);
	const [follow, setFollow] = useLocalStorage(`koholint:${settingsScope}.follow`, true);
	const [clickTeleport, setClickTeleport] = useLocalStorage(
		`koholint:${settingsScope}.clickTeleport`,
		true
	);
	// offline only renders avatar/palette; the name rides along untouched.
	const [profile, setProfile] = useLocalStorage<Profile>(profileKey, randomProfile);
	const [profileOpen, setProfileOpen] = useState(false);
	const [isAdmin] = useState(hasAdminToken);

	// mirrored into refs so init (called once per map load) can read the
	// current values when first constructing the player without taking
	// them as deps and re-running the whole load on every change.
	const profileRef = useLatestRef(profile);
	const gameRef = useRef<OfflineGame | null>(null);

	const init = useCallback(
		(ctx: MapRendererInitContext) => {
			const {map, world, renderer, mapPixelWidth, mapPixelHeight} = ctx;
			const clock = new GameClock(DEFAULT_TICK_RATE_HZ);
			// arriving from online mode keeps the player where they stood;
			// otherwise the last session's persisted position; otherwise spawn
			// fresh. the bounds check drops a stale stored pose from an older
			// shape of the map.
			const pose = takePlayerPose(mapUrl) ?? loadPlayerPose(mapUrl);
			const poseUsable =
				pose !== null &&
				pose.x >= 0 &&
				pose.x < mapPixelWidth &&
				pose.y >= 0 &&
				pose.y < mapPixelHeight;
			const spawn = poseUsable
				? pose
				: sampleSpawnOrCenter(collectSpawnRegions(map), mapPixelWidth, mapPixelHeight);
			const player = createBasicCharacter({
				id: PLAYER_CHARACTER_ID,
				sprite: resolveAvatarSprite(profileRef.current.avatarId),
				paletteSwap: resolvePaletteSwap(profileRef.current.paletteId),
				x: spawn.x,
				y: spawn.y,
				facing: poseUsable ? pose.facing : undefined,
			});
			world.addCharacter(player, new KeyboardInputProvider());
			resolveCharacterCollision(player, world.grid, world.holes);
			const invalidatePlayer = () => {
				renderer.invalidate(player.id);
				renderer.ensureLoaded([player]).catch(() => {});
			};
			gameRef.current = {world, clock, player, invalidatePlayer};
			return {
				follow: () => player,
				initialFocus: {
					x: player.x + player.spriteWidth / 2,
					y: player.y + player.spriteHeight / 2,
				},
				dispose: () => {
					// leaving the page: the online map starts its camera on this
					// pose after a mode switch, storage restores it next session.
					const {x, y, facing} = player;
					handOffPlayerPose(mapUrl, {x, y, facing});
					savePlayerPose(mapUrl, {x, y, facing});
					gameRef.current = null;
				},
			};
		},
		[mapUrl, profileRef]
	);

	const step = useCallback((dtMs: number) => {
		const game = gameRef.current;
		if (!game) return 0;
		game.clock.advance(dtMs, (tick, dtSec) => game.world.step(tick, dtSec));
		return game.clock.getInterpolationAlpha();
	}, []);

	const onTileClick = useCallback(
		({
			tileX,
			tileY,
			map,
		}: {
			tileX: number;
			tileY: number;
			map: {tilewidth: number; tileheight: number};
		}) => {
			if (!allowTeleport || !clickTeleport) return;
			const game = gameRef.current;
			if (!game) return;
			const tileCenterX = (tileX + 0.5) * map.tilewidth;
			const tileCenterY = (tileY + 0.5) * map.tileheight;
			const {player} = game;
			const box = player.collisionBox;
			player.x = tileCenterX - (box.x + box.width / 2);
			player.y = tileCenterY - (box.y + box.height / 2);
			player.prevX = player.x;
			player.prevY = player.y;
			player.jump = null;
			player.teleport = null;
			player.jumpOffsetY = 0;
			player.prevJumpOffsetY = 0;
			player.walking = false;
			player.animTimeMs = 0;
			resolveCharacterCollision(player, game.world.grid, game.world.holes);
		},
		[allowTeleport, clickTeleport]
	);

	const {canvasProps, state, playerTile} = useMapRenderer({
		mapUrl,
		follow,
		// the overlay is an admin diagnostic; a stored `true` stays inert for
		// everyone else.
		debug: debug && isAdmin,
		init,
		step,
		onTileClick,
	});

	// a reload or tab close skips react cleanup (and with it the dispose
	// above), so persist the position on pagehide too.
	useEffect(() => {
		const save = () => {
			const player = gameRef.current?.player;
			if (!player) return;
			const {x, y, facing} = player;
			savePlayerPose(mapUrl, {x, y, facing});
		};
		window.addEventListener("pagehide", save);
		return () => window.removeEventListener("pagehide", save);
	}, [mapUrl]);

	// push the latest avatar/palette selection onto the player and force the
	// renderer to refetch its image. gated on state.status so the first apply
	// happens after the hook's init has populated gameRef.
	useEffect(() => {
		const game = gameRef.current;
		if (!game || state.status !== "ok") return;
		game.player.sprite = resolveAvatarSprite(profile.avatarId);
		game.player.paletteSwap = resolvePaletteSwap(profile.paletteId);
		game.invalidatePlayer();
	}, [profile.avatarId, profile.paletteId, state.status]);

	return (
		<div className="fixed inset-0 overflow-hidden bg-neutral-900 font-mono">
			<canvas {...canvasProps} />
			{state.status === "error" ? (
				<div className="absolute inset-0 grid place-items-center p-4">
					<pre className="max-w-full whitespace-pre-wrap text-xs text-red-400">
						{state.message}
					</pre>
				</div>
			) : state.status === "loading" ? (
				<LoadingScreen />
			) : (
				<>
					<ProfileDialog
						open={profileOpen}
						onOpenChange={setProfileOpen}
						avatarId={profile.avatarId}
						paletteId={profile.paletteId}
						onChange={(a, p) =>
							setProfile((prev) => ({...prev, avatarId: a, paletteId: p}))
						}
					/>
					<HudBar>
						{onModeChange && (
							<ConnectionWidget
								mode="offline"
								onModeChange={onModeChange}
								status="idle"
								playerCount={0}
							/>
						)}
						<PositionWidget playerTile={playerTile} />
						<ProfileWidget onOpenProfile={() => setProfileOpen(true)} />
						<SettingsWidget>
							<SettingsCheckbox
								checked={follow}
								onChange={setFollow}
								label="Camera follow"
							/>
							{allowTeleport && (
								<SettingsCheckbox
									checked={clickTeleport}
									onChange={setClickTeleport}
									label="Click to teleport"
								/>
							)}
						</SettingsWidget>
						{isAdmin && (
							<AdminBadge>
								<SettingsCheckbox
									checked={debug}
									onChange={setDebug}
									label="Debug overlay"
								/>
							</AdminBadge>
						)}
					</HudBar>
				</>
			)}
		</div>
	);
}

export default MapPage;
