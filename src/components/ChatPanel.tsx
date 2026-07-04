import Chat, {AvatarCell, type ChatMessage, type ChatSettings} from "@/components/Chat";
import {Button} from "@/components/ui/button";
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@/components/ui/tooltip";
import {cn} from "@/lib/utils";
import type {ConnectionStatus} from "@/lib/wsClient";
import type {ConnId} from "@/protocol";
import {
	ArrowLeftRight,
	ChevronRight,
	MessageSquare,
	PanelLeftClose,
	PanelRightClose,
} from "lucide-react";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type PointerEvent as ReactPointerEvent,
} from "react";

const MIN_WIDTH = 240;
const MAX_WIDTH = 720;

export const DEFAULT_CHAT_WIDTH = 356;

export function clampChatWidth(w: number) {
	return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w));
}

// which window edge the chat panel docks to; the rest of the page UI (hud,
// show-chat button, map camera inset) mirrors along with it.
export type UiSide = "left" | "right";

export type PlayerListEntry = {
	readonly connId: ConnId;
	readonly name: string;
	readonly color: string;
	readonly avatarId: string;
	readonly paletteId: string | null;
};

type ChatPanelProps = {
	messages: readonly ChatMessage[];
	onSend?: (text: string) => void;
	settings?: ChatSettings;
	onSettingsChange?: (settings: ChatSettings) => void;
	// width, hidden and side are owned by the page so it can inset the map
	// camera by the space the panel actually covers and mirror the rest of the
	// UI. pass width through clampChatWidth.
	width: number;
	onWidthChange: (width: number) => void;
	hidden: boolean;
	onHiddenChange: (hidden: boolean) => void;
	side: UiSide;
	onSideChange: (side: UiSide) => void;
	status?: ConnectionStatus;
	players?: readonly PlayerListEntry[];
	playerListCollapsed?: boolean;
	onPlayerListCollapsedChange?: (collapsed: boolean) => void;
	canSend?: boolean;
};

function ChatPanel({
	messages,
	onSend,
	settings,
	onSettingsChange,
	width,
	onWidthChange,
	hidden,
	onHiddenChange,
	side,
	onSideChange,
	status,
	players,
	playerListCollapsed = false,
	onPlayerListCollapsedChange,
	canSend,
}: ChatPanelProps) {
	const [resizing, setResizing] = useState(false);
	const panelRef = useRef<HTMLDivElement | null>(null);

	const onResizePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
		if (e.button !== 0) return;
		e.preventDefault();
		setResizing(true);
	}, []);

	useEffect(() => {
		if (!resizing) return;
		const panel = panelRef.current;
		if (!panel) return;
		// the docked edge stays put while the opposite edge follows the cursor.
		const rect = panel.getBoundingClientRect();
		const onMove = (e: PointerEvent) => {
			onWidthChange(
				clampChatWidth(side === "right" ? rect.right - e.clientX : e.clientX - rect.left)
			);
		};
		const onUp = () => setResizing(false);
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
		window.addEventListener("pointercancel", onUp);
		const prevCursor = document.body.style.cursor;
		const prevSelect = document.body.style.userSelect;
		document.body.style.cursor = "ew-resize";
		document.body.style.userSelect = "none";
		return () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("pointercancel", onUp);
			document.body.style.cursor = prevCursor;
			document.body.style.userSelect = prevSelect;
		};
	}, [resizing, onWidthChange, side]);

	const awaySide = side === "right" ? "left" : "right";

	if (hidden) {
		return (
			<TooltipProvider>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							onClick={() => onHiddenChange(false)}
							aria-label="show chat"
							className={cn(
								"fixed top-2 z-10 bg-black/70 text-neutral-100 shadow-lg backdrop-blur hover:bg-black/80",
								side === "right" ? "right-2" : "left-2"
							)}
						>
							<MessageSquare />
						</Button>
					</TooltipTrigger>
					<TooltipContent side={awaySide}>Show chat</TooltipContent>
				</Tooltip>
			</TooltipProvider>
		);
	}

	const sendAllowed = canSend ?? (status === undefined || status === "connected");
	return (
		<TooltipProvider>
			<div
				ref={panelRef}
				style={{width}}
				className={cn(
					"fixed top-0 bottom-0 flex flex-col bg-black/70 font-mono text-xs text-neutral-100 shadow-lg backdrop-blur",
					side === "right" ? "right-0" : "left-0"
				)}
			>
				<Header
					status={status}
					playerCount={players?.length}
					side={side}
					onSwapSide={() => onSideChange(awaySide)}
					onHide={() => onHiddenChange(true)}
				/>
				{players ? (
					<PlayerListSection
						players={players}
						collapsed={playerListCollapsed}
						onToggle={() => onPlayerListCollapsedChange?.(!playerListCollapsed)}
					/>
				) : null}
				<Chat
					messages={messages}
					settings={settings}
					onSettingsChange={onSettingsChange}
					onSend={onSend}
					canSend={sendAllowed}
				/>
				<div
					role="separator"
					aria-orientation="vertical"
					onPointerDown={onResizePointerDown}
					className={cn(
						"absolute top-0 h-full w-2 cursor-ew-resize touch-none",
						side === "right" ? "-left-1" : "-right-1"
					)}
				/>
			</div>
		</TooltipProvider>
	);
}

export default ChatPanel;

const STATUS_LABEL: Record<ConnectionStatus, string> = {
	idle: "offline",
	connecting: "connecting",
	resuming: "resuming",
	connected: "connected",
	closed: "offline",
};

const STATUS_DOT_CLASS: Record<ConnectionStatus, string> = {
	idle: "bg-neutral-500",
	connecting: "bg-yellow-400",
	resuming: "bg-yellow-400",
	connected: "bg-green-400",
	closed: "bg-neutral-500",
};

type HeaderProps = {
	status?: ConnectionStatus;
	playerCount?: number;
	side: UiSide;
	onSwapSide: () => void;
	onHide: () => void;
};

function Header({status, playerCount, side, onSwapSide, onHide}: HeaderProps) {
	const awaySide = side === "right" ? "left" : "right";
	return (
		<div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-1 text-neutral-400">
			<div className="flex items-center gap-2 min-w-0">
				{status === undefined ? (
					<span>Chat</span>
				) : (
					<>
						<span
							aria-hidden
							className={cn(
								"h-2 w-2 shrink-0 rounded-full",
								STATUS_DOT_CLASS[status]
							)}
						/>
						<span>{STATUS_LABEL[status]}</span>
						{playerCount !== undefined ? (
							<span className="text-neutral-500">· {playerCount} online</span>
						) : null}
					</>
				)}
			</div>
			<div className="flex items-center">
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							onClick={onSwapSide}
							aria-label="switch ui side"
						>
							<ArrowLeftRight />
						</Button>
					</TooltipTrigger>
					<TooltipContent side={awaySide}>Switch side</TooltipContent>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							onClick={onHide}
							aria-label="hide chat"
						>
							{side === "right" ? <PanelRightClose /> : <PanelLeftClose />}
						</Button>
					</TooltipTrigger>
					<TooltipContent side={awaySide}>Hide chat</TooltipContent>
				</Tooltip>
			</div>
		</div>
	);
}

type PlayerListSectionProps = {
	players: readonly PlayerListEntry[];
	collapsed: boolean;
	onToggle: () => void;
};

function PlayerListSection({players, collapsed, onToggle}: PlayerListSectionProps) {
	const sorted = useMemo(
		() =>
			[...players].sort((a, b) =>
				a.name.localeCompare(b.name, undefined, {sensitivity: "base"})
			),
		[players]
	);
	return (
		<div className="border-b border-white/10">
			<button
				type="button"
				onClick={onToggle}
				className="flex w-full items-center gap-1 px-3 py-1 text-neutral-400 hover:text-neutral-200"
				aria-expanded={!collapsed}
			>
				<ChevronRight
					className={cn("h-3 w-3 transition-transform", collapsed ? "" : "rotate-90")}
				/>
				<span>Players ({sorted.length})</span>
			</button>
			{collapsed ? null : (
				<ul className="flex flex-col gap-0.5 px-3 pb-2">
					{sorted.map((p) => (
						<li key={p.connId} className="flex items-center gap-1.5 leading-snug">
							<AvatarCell avatarId={p.avatarId} paletteId={p.paletteId} />
							<span style={{color: p.color}} className="truncate">
								{p.name}
							</span>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
