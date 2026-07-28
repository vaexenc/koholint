// the headless simulation: physics, grids, the tick clock, and the map->world
// build. the server imports this barrel too, and type-checks without the DOM
// lib, so nothing re-exported here may touch a canvas, a window or an event —
// that half lives in @/client/game.

export * from "./cellGrid";
export * from "./character";
export * from "./characterStep";
export * from "./cliffs";
export * from "./clock";
export * from "./collision";
export * from "./controllers";
export * from "./grids";
// generic numeric math lives in @/shared/lib, not the sim; re-exported here so the
// simulation modules can keep taking it off their own barrel.
export {clamp, lerp} from "@/shared/lib/math";
export * from "./push";
export * from "./spawn";
export * from "./teleport";
export * from "./terrain";
export * from "./types";
export * from "./world";
