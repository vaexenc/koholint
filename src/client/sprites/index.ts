// the browser-facing half of the sprite package: everything that rasterizes a
// sheet, recolors one on the GPU, or decodes an image. the headless half is
// @/shared/sprites, and the server reaches into it for real work —
// profileAccent derives a player's colour from the avatar catalog, and
// parseClientMessage validates ids against it — so one canvas import on that
// path would fail the build. the tree split is what keeps that from happening,
// exactly as in @/client/game.
//
// paletteSwap is deliberately absent: recolorImageCached is an implementation
// detail of resolveSpriteSource, and draw.ts is the only thing that should
// reach it.

export * from "./draw";
export * from "./preloadAvatars";
export * from "./spriteBox";
