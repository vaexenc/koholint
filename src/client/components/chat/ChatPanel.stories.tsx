import ChatPanel from "@/client/components/chat/ChatPanel";
import {
	DEFAULT_CHAT_WIDTH,
	DEFAULT_PLAYER_LIST_HEIGHT,
	type UiSide,
} from "@/client/components/chat/chatPanelLayout";
import type {ConnectionStatus} from "@/client/session/net/wsClient";
import type {PlayerListEntry} from "@/client/session/usePlayerRoster";
import {DEFAULT_CHAT_SETTINGS, type ChatSettings} from "@/client/settings/chatSettings";
import type {ChatMessage} from "@/shared/protocol";
import type {HexColor} from "@/shared/sprites/types";
import type {Meta, StoryObj} from "@storybook/tanstack-react";
import {useState} from "react";

// fixed base so timestamps render deterministically; each message is offset a
// minute or two off it rather than reading the wall clock.
const BASE_TS = new Date("2026-07-15T14:30:00").getTime();
const at = (minutes: number) => BASE_TS + minutes * 60_000;

// the sender identity fields shared by every chat/presence row.
type Sender = {
	senderId: string;
	name: string;
	color: HexColor;
	avatarId: string;
	paletteId: string | null;
};

const ME: Sender = {
	senderId: "me",
	name: "You",
	color: "#7dd3fc",
	avatarId: "link",
	paletteId: null,
};

const MARIN: Sender = {
	senderId: "u2",
	name: "Marin",
	color: "#f9a8d4",
	avatarId: "marin",
	paletteId: null,
};

const TARIN: Sender = {
	senderId: "u3",
	name: "Tarin",
	color: "#fcd34d",
	avatarId: "tarin",
	paletteId: "green",
};

const toPlayer = (s: Sender): PlayerListEntry => ({
	connId: s.senderId,
	name: s.name,
	color: s.color,
	avatarId: s.avatarId,
	paletteId: s.paletteId,
});

const PLAYERS: readonly PlayerListEntry[] = [ME, MARIN, TARIN].map(toPlayer);

// a small pool of distinct looks, cycled to fill a very long roster so the
// player list's scrolling and layout can be eyeballed under load.
const PLAYER_POOL: readonly Omit<PlayerListEntry, "connId">[] = [
	{name: "Link", color: "#7dd3fc", avatarId: "link", paletteId: null},
	{name: "Marin", color: "#f9a8d4", avatarId: "marin", paletteId: null},
	{name: "Tarin", color: "#fcd34d", avatarId: "tarin", paletteId: "green"},
	{name: "Zelda", color: "#c4b5fd", avatarId: "zelda", paletteId: null},
	{name: "Ganon", color: "#fca5a5", avatarId: "ganon", paletteId: "red"},
	{name: "Saria", color: "#86efac", avatarId: "saria", paletteId: "green"},
	{name: "Malon", color: "#fdba74", avatarId: "malon", paletteId: null},
	{name: "Impa", color: "#d1d5db", avatarId: "impa", paletteId: null},
	{name: "Ruto", color: "#93c5fd", avatarId: "ruto", paletteId: "blue"},
	{name: "Darunia", color: "#f0abfc", avatarId: "darunia", paletteId: null},
];

const MANY_PLAYERS: readonly PlayerListEntry[] = Array.from({length: 1001}, (_, i) => {
	const base = PLAYER_POOL[i % PLAYER_POOL.length];
	return {...base, connId: `p${i}`, name: `${base.name} ${i}`};
});

const MESSAGES: readonly ChatMessage[] = [
	{id: "s1", kind: "system", text: "Welcome to Koholint.", timestamp: at(0)},
	{id: "p1", kind: "presence", action: "join", ...MARIN, timestamp: at(1)},
	{
		id: "c1",
		kind: "chat",
		...MARIN,
		text: "Did you hear that? It sounded like the Wind Fish.",
		timestamp: at(2),
	},
	{
		id: "c2",
		kind: "chat",
		...ME,
		text: "On my way to the Mysterious Forest now.",
		timestamp: at(3),
	},
	{
		id: "c3",
		kind: "chat",
		...TARIN,
		// filtered by default; the obscenity toggle reveals `rawText`.
		text: "these ****ing mushrooms are everywhere",
		rawText: "these bloody mushrooms are everywhere",
		timestamp: at(4),
	},
	{id: "p2", kind: "presence", action: "leave", ...MARIN, timestamp: at(5)},
];

// mirrors the app: the page owns messages, settings, width, side, hidden and
// the player-list collapse. the harness holds all of it so sending appends a
// row, the settings popover toggles apply, and the header/resize controls work.
function ChatPanelHarness({
	messages: initialMessages,
	settings: initialSettings = DEFAULT_CHAT_SETTINGS,
	players,
	status = "connected",
}: {
	messages: readonly ChatMessage[];
	settings?: ChatSettings;
	players?: readonly PlayerListEntry[];
	status?: ConnectionStatus;
}) {
	const [messages, setMessages] = useState(initialMessages);
	const [settings, setSettings] = useState(initialSettings);
	const [width, setWidth] = useState(DEFAULT_CHAT_WIDTH);
	const [hidden, setHidden] = useState(false);
	const [side, setSide] = useState<UiSide>("right");
	const [collapsed, setCollapsed] = useState(false);
	const [playerListHeight, setPlayerListHeight] = useState(DEFAULT_PLAYER_LIST_HEIGHT);

	return (
		<ChatPanel
			messages={messages}
			settings={settings}
			onSettingsChange={setSettings}
			status={status}
			onSend={(text) =>
				setMessages((prev) => [
					...prev,
					{id: `local-${prev.length}`, kind: "chat", ...ME, text, timestamp: Date.now()},
				])
			}
			width={width}
			onWidthChange={setWidth}
			hidden={hidden}
			onHiddenChange={setHidden}
			side={side}
			onSideChange={setSide}
			players={players}
			playerListCollapsed={collapsed}
			onPlayerListCollapsedChange={setCollapsed}
			playerListHeight={playerListHeight}
			onPlayerListHeightChange={setPlayerListHeight}
		/>
	);
}

// ChatPanel pins itself to a viewport edge, so the panel is the whole story.
const meta = {
	title: "Components/ChatPanel",
	component: ChatPanelHarness,
	parameters: {layout: "fullscreen"},
	args: {
		messages: MESSAGES,
		players: PLAYERS,
	},
} satisfies Meta<typeof ChatPanelHarness>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// a fresh room with nothing said yet.
export const Empty: Story = {
	args: {messages: []},
};

// presence lines are opt-in; turning them on surfaces the join/leave rows.
export const WithPresence: Story = {
	args: {settings: {...DEFAULT_CHAT_SETTINGS, presenceMode: "on"}},
};

// obscenity reveal on: Tarin's line shows its unfiltered `rawText`.
export const ObscenitiesRevealed: Story = {
	args: {settings: {...DEFAULT_CHAT_SETTINGS, obscenityMode: "on"}},
};

// avatars off + timestamps off strips both leading columns for a plainer log.
export const MinimalRows: Story = {
	args: {settings: {...DEFAULT_CHAT_SETTINGS, avatarMode: "off", timestampMode: "off"}},
};

// input + send disabled, as while the socket is connecting or resuming.
export const CannotSend: Story = {
	args: {status: "connecting"},
};

// no player list passed — the header stays but the players section is omitted.
export const WithoutPlayerList: Story = {
	args: {players: undefined},
};

// a huge roster (1001 players) to stress the player list's scroll and layout.
export const ManyPlayers: Story = {
	args: {players: MANY_PLAYERS},
};
