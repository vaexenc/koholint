import type {GameHooks} from "@/client/session/gameHost";
import type {PlayerPose} from "@/client/session/playerPose";
import type {SelfControls} from "@/client/session/selfControls";
import type {BasicCharacter, KeyBindings} from "@/shared/game";
import type {Profile} from "@/shared/protocol";

// the control surface both map games expose, and the whole of what the page
// layer drives them through. OfflineGame is the mirror image of OnlineGame —
// the same surface, minus everything the network adds — and declaring that here
// is what keeps it true: a method renamed on one side stops compiling instead of
// quietly leaving the two pages wired differently.
//
// the network is a dependency of the online game, not a parameter of its
// methods, so `step` has the same signature on both sides and this can declare
// it. that is also what lets the page layer hold one binding for the render
// loop instead of one per mode.
export interface MapGame {
	// every player input channel, as one handle. the individual providers stay
	// the games' own business: nothing above this line has ever needed to know
	// there are two of them.
	readonly controls: SelfControls;
	// advance the simulation by dtMs; returns the interpolation alpha (0..1) the
	// renderer draws characters between poses with.
	step(dtMs: number): number;
	// the hint the online game retires on a custom mapping makes this more than
	// a pass-through to `controls`, so it stays on the surface.
	setKeyBindings(bindings: KeyBindings): void;
	applySelfProfile(profile: Profile): void;
	// the character the camera follows; null until the world has placed one.
	followTarget(): BasicCharacter | null;
	// last known pose, for handing off to the other mode on a route switch.
	selfPose(): PlayerPose | null;
}

// the part of a renderer setup that is the same whichever game is running: the
// camera's follow target and the two input channels the renderer drives. each
// page spreads this and adds only what is genuinely its own — the focus handoff,
// the overlays, the teardown.
export function mapGameSetup(game: MapGame): Pick<GameHooks, "follow" | "onSteer" | "zoomInput"> {
	return {
		follow: () => game.followTarget(),
		onSteer: (point) => game.controls.setScreenTarget(point),
		zoomInput: () => game.controls.zoomInput(),
	};
}
