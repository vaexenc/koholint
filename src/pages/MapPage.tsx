import {AVATARS} from "@/components/avatar-picker/registry";
import {LoadingScreen} from "@/components/LoadingScreen";
import {SettingsDialog} from "@/components/SettingsDialog";
import {Button} from "@/components/ui/button";
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
import {useLocalStorage} from "@/lib/useLocalStorage";
import {useMapRenderer, type MapRendererInitContext} from "@/pages/useMapRenderer";
import {PALETTES} from "@/sprites/palettes";
import {useCallback, useEffect, useRef, useState} from "react";

function resolveAvatarSprite(avatarId: string) {
	return (AVATARS.find((a) => a.id === avatarId) ?? AVATARS[0]).sprite;
}

function resolvePaletteSwap(paletteId: string | null) {
	if (!paletteId) return undefined;
	return PALETTES.find((p) => p.id === paletteId)?.palette;
}

const DEFAULT_MAP_URL = "/maps/overworld.json";
const PLAYER_CHARACTER_ID = "player-link";
const MIN_TICK_RATE_HZ = 5;
const MAX_TICK_RATE_HZ = 120;

type MapPageProps = {
	mapUrl?: string;
};

type OfflineGame = {
	world: World;
	clock: GameClock;
	player: BasicCharacter;
	invalidatePlayer: () => void;
};

function MapPage({mapUrl = DEFAULT_MAP_URL}: MapPageProps) {
	const [debug, setDebug] = useLocalStorage("koholint:map.debug", false);
	const [follow, setFollow] = useLocalStorage("koholint:map.follow", false);
	const [tickRate, setTickRate] = useLocalStorage("koholint:map.tickRate", DEFAULT_TICK_RATE_HZ);
	const [avatarId, setAvatarId] = useLocalStorage<string>(
		"koholint:player.avatarId",
		AVATARS[0].id
	);
	const [paletteId, setPaletteId] = useLocalStorage<string | null>(
		"koholint:player.paletteId",
		null
	);
	const [pickerOpen, setPickerOpen] = useState(false);

	// mirrored into refs so init (called once per map load) can read the
	// current selection when first constructing the player without taking
	// them as deps and re-running the whole load on every change.
	const avatarIdRef = useRef(avatarId);
	const paletteIdRef = useRef(paletteId);
	const tickRateRef = useRef(tickRate);
	const gameRef = useRef<OfflineGame | null>(null);

	useEffect(() => {
		avatarIdRef.current = avatarId;
	}, [avatarId]);

	useEffect(() => {
		paletteIdRef.current = paletteId;
	}, [paletteId]);

	useEffect(() => {
		tickRateRef.current = tickRate;
		gameRef.current?.clock.setTickRate(tickRate);
	}, [tickRate]);

	const init = useCallback((ctx: MapRendererInitContext) => {
		const {map, world, renderer, mapPixelWidth, mapPixelHeight} = ctx;
		const clock = new GameClock(tickRateRef.current);
		const spawn = sampleSpawnOrCenter(collectSpawnRegions(map), mapPixelWidth, mapPixelHeight);
		const player = createBasicCharacter({
			id: PLAYER_CHARACTER_ID,
			sprite: resolveAvatarSprite(avatarIdRef.current),
			paletteSwap: resolvePaletteSwap(paletteIdRef.current),
			x: spawn.x,
			y: spawn.y,
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
				gameRef.current = null;
			},
		};
	}, []);

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
		[]
	);

	const {canvasProps, state, zoom, cursor} = useMapRenderer({
		mapUrl,
		follow,
		debug,
		init,
		step,
		onTileClick,
	});

	// push the latest avatar/palette selection onto the player and force the
	// renderer to refetch its image. gated on state.status so the first apply
	// happens after the hook's init has populated gameRef.
	useEffect(() => {
		const game = gameRef.current;
		if (!game || state.status !== "ok") return;
		game.player.sprite = resolveAvatarSprite(avatarId);
		game.player.paletteSwap = resolvePaletteSwap(paletteId);
		game.invalidatePlayer();
	}, [avatarId, paletteId, state.status]);

	const map = state.status === "ok" ? state.map : null;
	const tileX = map && cursor ? Math.floor(cursor.x / map.tilewidth) : null;
	const tileY = map && cursor ? Math.floor(cursor.y / map.tileheight) : null;

	return (
		<div className="fixed inset-0 overflow-hidden bg-neutral-900 font-mono">
			<canvas {...canvasProps} />
			{state.status === "loading" && <LoadingScreen />}
			<div className="absolute top-2 left-2 rounded bg-black/70 p-3 text-xs text-neutral-100 shadow-lg backdrop-blur">
				{state.status === "error" && (
					<pre className="whitespace-pre-wrap text-red-400">{state.message}</pre>
				)}
				<div className="flex flex-col gap-2">
					<label className="flex items-center gap-2">
						<input
							type="checkbox"
							checked={debug}
							onChange={(e) => setDebug(e.target.checked)}
						/>
						debug overlay
					</label>
					<label className="flex items-center gap-2">
						<input
							type="checkbox"
							checked={follow}
							onChange={(e) => setFollow(e.target.checked)}
						/>
						follow player (wasd / arrows)
					</label>
					<label className="flex items-center gap-2">
						<span className="text-neutral-400">tick rate</span>
						<input
							type="range"
							min={MIN_TICK_RATE_HZ}
							max={MAX_TICK_RATE_HZ}
							step={1}
							value={tickRate}
							onChange={(e) => setTickRate(Number(e.target.value))}
						/>
						<span className="tabular-nums">{tickRate} Hz</span>
					</label>
					<SettingsDialog
						open={pickerOpen}
						onOpenChange={setPickerOpen}
						avatarId={avatarId}
						paletteId={paletteId}
						onChange={(a, p) => {
							setAvatarId(a);
							setPaletteId(p);
						}}
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
		</div>
	);
}

export default MapPage;
