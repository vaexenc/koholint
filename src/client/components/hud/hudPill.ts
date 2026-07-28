// shared material of the map HUD overlays: translucent black pills and their
// popovers. widgets append their own padding/gap; interactive pills add the
// hover/focus affordances.
export const HUD_PILL =
	"inline-flex items-center rounded-full bg-black/70 font-mono text-xs text-neutral-100 backdrop-blur";

export const HUD_PILL_INTERACTIVE = `${HUD_PILL} cursor-pointer transition-colors outline-none hover:bg-black/80 focus-visible:ring-2 focus-visible:ring-white/40`;

// padding of a circular icon-only pill, grown on coarse pointers for a usable
// touch target. next to the material rather than repeated at each icon widget,
// so the badge and the widget buttons stay the same size as each other.
export const HUD_PILL_ICON_PADDING = "p-2 pointer-coarse:p-2.5";

export const HUD_POPOVER =
	"rounded-xl border-0 bg-black/70 font-mono text-xs text-neutral-100 shadow-none ring-0 backdrop-blur";
