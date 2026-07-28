import {clamp} from "@/shared/lib/math";

// where the chat panel sits and how big it may get. this is the contract between
// the panel and the page that hosts it — the page insets the map camera by the
// space the panel covers and mirrors the HUD to follow the dock, so it has to
// know all of this anyway. keeping it out of the panel component is what lets
// useChatPanelState depend on the contract rather than on the view.

// which window edge the chat panel docks to; the rest of the page UI (hud,
// show-chat button, map camera inset) mirrors along with it.
export type UiSide = "left" | "right";

// the far edge — where a tooltip or the mirrored HUD goes. the type already
// models "one of two edges", so its complement belongs beside it rather than
// being re-derived at each use site.
export function opposite(side: UiSide): UiSide {
	return side === "right" ? "left" : "right";
}

const MIN_WIDTH = 240;
const MAX_WIDTH = 720;

export const DEFAULT_CHAT_WIDTH = 356;

export function clampChatWidth(w: number) {
	return clamp(w, MIN_WIDTH, MAX_WIDTH);
}

const MIN_PLAYER_LIST_HEIGHT = 48;
const MAX_PLAYER_LIST_HEIGHT = 600;

export const DEFAULT_PLAYER_LIST_HEIGHT = 160;

export function clampPlayerListHeight(h: number) {
	return clamp(h, MIN_PLAYER_LIST_HEIGHT, MAX_PLAYER_LIST_HEIGHT);
}

// the panel's own layout state, which the page owns rather than the panel.
// widths and heights come back through clampChatWidth / clampPlayerListHeight.
// useChatPanelState produces exactly this shape.
export type ChatPanelLayout = {
	width: number;
	onWidthChange: (width: number) => void;
	hidden: boolean;
	onHiddenChange: (hidden: boolean) => void;
	side: UiSide;
	onSideChange: (side: UiSide) => void;
	playerListCollapsed: boolean;
	onPlayerListCollapsedChange: (collapsed: boolean) => void;
	playerListHeight: number;
	onPlayerListHeightChange: (height: number) => void;
};
