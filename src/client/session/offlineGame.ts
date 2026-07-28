import {appearanceOf, applyAppearance} from "@/client/session/appearance";
import type {GameHostContext} from "@/client/session/gameHost";
import type {MapGame} from "@/client/session/mapGame";
import type {PlayerPose} from "@/client/session/playerPose";
import {SelfControls} from "@/client/session/selfControls";
import {
	collectSpawnRegions,
	collisionCenter,
	createBasicCharacter,
	DEFAULT_TICK_RATE_HZ,
	GameClock,
	sampleSpawnOrCenter,
	teleportToTile,
	type BasicCharacter,
	type KeyBindings,
	type World,
} from "@/shared/game";
import type {Profile} from "@/shared/protocol";

const SELF_ENTITY_ID = "player-link";

export type OfflineGameDeps = {
	readonly profile: () => Profile;
	// where the player stood on arrival — handed over from the online map on a
	// mode switch, or restored from the last session, and already checked
	// against this map (see takeArrivalPose). null spawns fresh.
	readonly pose: PlayerPose | null;
};

// owns the single-player simulation for one map load: the character, its input
// controls and the tick clock. the mirror image of OnlineGame — same control
// surface, minus everything the network adds — so the two pages drive their
// game the same way and the page layer stays pure chrome. MapGame is that
// surface, and implementing it is what keeps the two in step.
export class OfflineGame implements MapGame {
	readonly selfChar: BasicCharacter;
	readonly controls: SelfControls;
	private readonly world: World;
	private readonly clock = new GameClock(DEFAULT_TICK_RATE_HZ);
	private readonly renderer: GameHostContext["renderer"];
	private readonly map: GameHostContext["map"];

	constructor(ctx: GameHostContext, deps: OfflineGameDeps) {
		this.world = ctx.world;
		this.renderer = ctx.renderer;
		this.map = ctx.map;
		const spawn =
			deps.pose ??
			sampleSpawnOrCenter(
				collectSpawnRegions(ctx.map),
				ctx.mapPixelWidth,
				ctx.mapPixelHeight
			);
		this.selfChar = createBasicCharacter({
			id: SELF_ENTITY_ID,
			...appearanceOf(deps.profile()),
			x: spawn.x,
			y: spawn.y,
			facing: deps.pose?.facing,
		});
		this.controls = new SelfControls({
			screenToWorld: ctx.screenToWorld,
			origin: () => collisionCenter(this.selfChar),
		});
		// addCharacter resolves the spawn out of any solid it landed in.
		this.world.addCharacter(this.selfChar, this.controls.provider);
	}

	setKeyBindings(bindings: KeyBindings): void {
		this.controls.setBindings(bindings);
	}

	applySelfProfile(profile: Profile): void {
		applyAppearance(this.renderer, this.selfChar, profile);
	}

	step(dtMs: number): number {
		this.clock.advance(dtMs, (tick, dtSec) => this.world.step(tick, dtSec));
		return this.clock.getInterpolationAlpha();
	}

	followTarget(): BasicCharacter {
		return this.selfChar;
	}

	selfPose(): PlayerPose {
		const {x, y, facing} = this.selfChar;
		return {x, y, facing};
	}

	// admin/test-map teleport: drops the character on the tile under a click and
	// nudges it out of anything solid it landed in.
	teleportTo(worldX: number, worldY: number): void {
		teleportToTile(this.selfChar, this.map, this.world.grids, worldX, worldY);
	}
}
