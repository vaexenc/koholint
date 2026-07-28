// the browser-facing half of the game package: everything that draws to a
// canvas or binds DOM events. the headless half the server shares is
// @/shared/game; this is what only a browser can run.
//
// the tree a file sits in is the boundary, so a new module lands on the right
// side of the DOM line by where it is saved rather than by remembering to list
// it in the correct barrel — and getting it wrong is a build error, not a
// convention someone has to enforce: @/shared is a root of both tsconfig
// projects, so it type-checks without the DOM, and @/client is in neither the
// server project nor its reach.

export * from "./chatBubbles";
export * from "./debugOverlay";
export * from "./keyboardInput";
export * from "./movementHint";
export * from "./nameTags";
export * from "./render";
export * from "./zeldaFont";
