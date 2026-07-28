import {
	clampChatWidth,
	clampPlayerListHeight,
	DEFAULT_CHAT_WIDTH,
	DEFAULT_PLAYER_LIST_HEIGHT,
	type ChatPanelLayout,
	type UiSide,
} from "@/client/components/chat/chatPanelLayout";
import {
	storedBoolean,
	storedNumber,
	storedOneOf,
	useLocalStorage,
} from "@/client/lib/hooks/useLocalStorage";
import {useIsSmallScreen} from "@/client/lib/hooks/useMediaQuery";
import {useState} from "react";

const UI_SIDE_STORAGE = storedOneOf<UiSide>(["left", "right"]);
// clamped on the way out of storage, so the panel and the camera inset always
// agree on the same width.
const CHAT_WIDTH_STORAGE = storedNumber(clampChatWidth);
const PLAYER_LIST_HEIGHT_STORAGE = storedNumber(clampPlayerListHeight);

export type ChatPanelState = {
	// hand straight to <ChatPanel>.
	readonly layout: ChatPanelLayout;
	// CSS px of each window edge the panel covers, for the camera's clamp.
	readonly insets: {readonly left: number; readonly right: number};
	// true while the panel docks left, so the HUD rows mirror to the far corner
	// and leave it the edge.
	readonly reversed: boolean;
};

// where the chat panel sits and how much of the window it takes — persisted
// across sessions, and read back by the page as camera insets and a HUD mirror
// flag. all layout, no conversation: the page keeps routing the messages, and
// none of that has to sit next to six storage slots to do it.
export function useChatPanelState(): ChatPanelState {
	const [width, setWidth] = useLocalStorage(
		"koholint:chat.width",
		DEFAULT_CHAT_WIDTH,
		CHAT_WIDTH_STORAGE
	);
	// on small screens the chat is a full-screen overlay, so it starts hidden
	// there — the map is the first thing a phone user should see.
	const smallScreen = useIsSmallScreen();
	const [hidden, setHidden] = useState(smallScreen);
	const [side, setSide] = useLocalStorage<UiSide>("koholint:ui.side", "right", UI_SIDE_STORAGE);
	const [playerListCollapsed, setPlayerListCollapsed] = useLocalStorage(
		"koholint:chat.playerListCollapsed",
		false,
		storedBoolean
	);
	const [playerListHeight, setPlayerListHeight] = useLocalStorage(
		"koholint:chat.playerListHeight",
		DEFAULT_PLAYER_LIST_HEIGHT,
		PLAYER_LIST_HEIGHT_STORAGE
	);

	// on a small screen the panel overlays the whole viewport instead of docking,
	// so it covers nothing the camera has to work around.
	const covered = hidden || smallScreen ? 0 : width;
	return {
		layout: {
			width,
			onWidthChange: setWidth,
			hidden,
			onHiddenChange: setHidden,
			side,
			onSideChange: setSide,
			playerListCollapsed,
			onPlayerListCollapsedChange: setPlayerListCollapsed,
			playerListHeight,
			onPlayerListHeightChange: setPlayerListHeight,
		},
		insets: {
			left: side === "left" ? covered : 0,
			right: side === "right" ? covered : 0,
		},
		reversed: side === "left",
	};
}
