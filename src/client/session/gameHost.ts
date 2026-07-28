import type {CharacterRenderer} from "@/client/game";
import {interpolatedPose, type BasicCharacter, type World} from "@/shared/game";
import type {TiledMap} from "@/shared/tiled/loadMap";

// the contract between a map game and its host: what the host hands a game at
// load, and what the game hands back for the render loop to drive it through.
// it sits beside the games rather than with the host, so both are written
// against one declaration neither owns. @/client/viewport/mapHost.ts is the host.

export type FollowTarget = Pick<
	BasicCharacter,
	| "x"
	| "y"
	| "prevX"
	| "prevY"
	| "jumpOffsetY"
	| "prevJumpOffsetY"
	| "spriteWidth"
	| "spriteHeight"
	| "collisionBox"
>;

// the world point a camera centers on to show a character: the middle of its
// sprite, not the top-left anchor a pose is expressed in. `at` overrides where
// the sprite stands, for a pose handed over from the other mode before the
// character has been placed on it. the one derivation, so the initial focus a
// page asks for and the snap the render loop performs can't land half a sprite
// apart.
export function spriteFocus(
	sprite: Pick<FollowTarget, "x" | "y" | "spriteWidth" | "spriteHeight">,
	at: {readonly x: number; readonly y: number} = sprite
): {x: number; y: number} {
	return {x: at.x + sprite.spriteWidth / 2, y: at.y + sprite.spriteHeight / 2};
}

// the same point mid-tick. the renderer draws a character lerped between its
// previous and current pose, so a camera chasing one has to aim at that same
// interpolated position or it trails the sprite by up to a tick. built on
// spriteFocus and interpolatedPose rather than beside them, so neither where the
// middle of a sprite is nor how a pose interpolates is decided twice.
//
// the hop lift is deliberately dropped: the camera tracks where the body stands,
// not where the sprite is drawn, so a hop — or a teleport's 180px rise — doesn't
// sweep the viewport with it.
export function interpolatedSpriteFocus(
	target: FollowTarget,
	alpha: number
): {x: number; y: number} {
	return spriteFocus(target, interpolatedPose(target, alpha));
}

export type GameHostContext = {
	readonly map: TiledMap;
	readonly world: World;
	readonly renderer: CharacterRenderer;
	readonly mapPixelWidth: number;
	readonly mapPixelHeight: number;
	// projects a client-space (CSS px) point into world coordinates under the
	// live camera. safe to call every tick — it reads the camera at call time.
	readonly screenToWorld: (x: number, y: number) => readonly [number, number];
};

// what `init` hands back: everything the render loop drives the page's game
// through. all of it but the overlay is mandatory — every game exposes a follow
// target, a steer channel and a zoom input (see mapGameSetup, which is where
// those three come from) and owns something to tear down, so the host never has
// to ask whether a page wired one up.
export type GameHooks = {
	// the camera's follow target, re-resolved every frame; null while the world
	// has yet to place one.
	follow: () => FollowTarget | null;
	// world-space point to center the camera on at load instead of the map's
	// geometric center (e.g. a spawn area). does not move with the simulation —
	// the follow target takes over once follow is enabled. null centers the map.
	initialFocus: {x: number; y: number} | null;
	// per-frame screen-space overlay, drawn on the main canvas (CSS pixels)
	// after the offscreen blit so it stays crisp regardless of camera zoom.
	// `worldToScreen` projects a world-space anchor into the same CSS-pixel
	// space the overlay draws in. `textScale` is how much above-head text should
	// grow at the current zoom — the camera owns that curve, so the overlay
	// never has to know what scale it opened at. used for the movement hint.
	drawScreenOverlay?: (
		ctx: CanvasRenderingContext2D,
		alpha: number,
		worldToScreen: (x: number, y: number) => readonly [number, number],
		textScale: number
	) => void;
	// receives the pointer position (client CSS px) of a hold-to-walk gesture —
	// re-fed on every move, null when the gesture ends. single-finger touch
	// always steers, and the left mouse/pen button does when clickToMove is set;
	// two-finger pan/zoom, other-button drags, and tap/click-to-teleport keep
	// working either way.
	onSteer: (point: {x: number; y: number} | null) => void;
	// held keyboard-zoom direction, sampled per frame: +1 in, -1 out, 0 idle.
	// the camera owns rate, anchoring, and limits; the game side owns which
	// keys mean zoom and when input is suspended (modals, text entry).
	zoomInput: () => number;
	dispose: () => void;
};

export type TileClickArgs = {
	readonly worldX: number;
	readonly worldY: number;
	readonly tileX: number;
	readonly tileY: number;
	readonly map: TiledMap;
};
