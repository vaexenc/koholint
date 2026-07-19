import Chat, {AvatarCell, type ChatMessage, type ChatSettings} from "@/components/Chat";
import {Button} from "@/components/ui/button";
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@/components/ui/tooltip";
import {useIsSmallScreen} from "@/lib/useMediaQuery";
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
	type Ref,
} from "react";

const MIN_WIDTH = 240;
const MAX_WIDTH = 720;

export const DEFAULT_CHAT_WIDTH = 356;

export function clampChatWidth(w: number) {
	return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w));
}

const MIN_PLAYER_LIST_HEIGHT = 48;
const MAX_PLAYER_LIST_HEIGHT = 600;

export const DEFAULT_PLAYER_LIST_HEIGHT = 160;

export function clampPlayerListHeight(h: number) {
	return Math.min(MAX_PLAYER_LIST_HEIGHT, Math.max(MIN_PLAYER_LIST_HEIGHT, h));
}

// shared drag-to-resize plumbing: pointerdown arms the drag, window-level
// pointer tracking drives `createOnMove`'s handler, and the body cursor/text
// selection are overridden for the duration. `createOnMove` runs once at drag
// start so it can capture the geometry the drag is measured against.
function useDragResize(
	cursor: "ew-resize" | "ns-resize",
	createOnMove: () => ((e: PointerEvent) => void) | null
) {
	const [dragging, setDragging] = useState(false);

	const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
		if (e.button !== 0) return;
		e.preventDefault();
		setDragging(true);
	}, []);

	useEffect(() => {
		if (!dragging) return;
		const onMove = createOnMove();
		if (!onMove) return;
		const onUp = () => setDragging(false);
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
		window.addEventListener("pointercancel", onUp);
		const prevCursor = document.body.style.cursor;
		const prevSelect = document.body.style.userSelect;
		document.body.style.cursor = cursor;
		document.body.style.userSelect = "none";
		return () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("pointercancel", onUp);
			document.body.style.cursor = prevCursor;
			document.body.style.userSelect = prevSelect;
		};
	}, [dragging, createOnMove, cursor]);

	return onPointerDown;
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
	// pass through clampPlayerListHeight, same deal as width.
	playerListHeight?: number;
	onPlayerListHeightChange?: (height: number) => void;
	canSend?: boolean;
	// lets the page focus the compose input from outside (Enter jumps into chat).
	inputRef?: Ref<HTMLInputElement>;
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
	playerListHeight = DEFAULT_PLAYER_LIST_HEIGHT,
	onPlayerListHeightChange,
	canSend,
	inputRef,
}: ChatPanelProps) {
	const panelRef = useRef<HTMLDivElement | null>(null);
	// below `sm` the panel becomes a full-screen overlay: no side docking, no
	// width resizing, and it covers the HUD (z-20 over its z-10).
	const smallScreen = useIsSmallScreen();

	const onResizePointerDown = useDragResize(
		"ew-resize",
		useCallback(() => {
			const panel = panelRef.current;
			if (!panel) return null;
			// the docked edge stays put while the opposite edge follows the cursor.
			const rect = panel.getBoundingClientRect();
			return (e: PointerEvent) =>
				onWidthChange(
					clampChatWidth(
						side === "right" ? rect.right - e.clientX : e.clientX - rect.left
					)
				);
		}, [onWidthChange, side])
	);

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
								"fixed top-[max(0.5rem,env(safe-area-inset-top))] z-10 bg-black/70 text-neutral-100 shadow-lg backdrop-blur hover:bg-black/80",
								side === "right"
									? "right-[max(0.5rem,env(safe-area-inset-right))]"
									: "left-[max(0.5rem,env(safe-area-inset-left))]"
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
				style={smallScreen ? undefined : {width}}
				className={cn(
					"fixed top-0 bottom-0 flex flex-col bg-black/70 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] font-mono text-xs text-neutral-100 shadow-lg backdrop-blur",
					smallScreen ? "inset-x-0 z-20" : side === "right" ? "right-0" : "left-0"
				)}
			>
				<Header
					side={side}
					onSwapSide={() => onSideChange(awaySide)}
					onHide={() => onHiddenChange(true)}
				/>
				{players ? (
					<PlayerListSection
						players={players}
						collapsed={playerListCollapsed}
						onToggle={() => onPlayerListCollapsedChange?.(!playerListCollapsed)}
						height={playerListHeight}
						onHeightChange={onPlayerListHeightChange}
					/>
				) : null}
				<Chat
					messages={messages}
					settings={settings}
					onSettingsChange={onSettingsChange}
					onSend={onSend}
					canSend={sendAllowed}
					inputRef={inputRef}
				/>
				{smallScreen ? null : (
					<div
						role="separator"
						aria-orientation="vertical"
						onPointerDown={onResizePointerDown}
						className={cn(
							"absolute top-0 h-full w-2 cursor-ew-resize touch-none",
							side === "right" ? "-left-1" : "-right-1"
						)}
					/>
				)}
			</div>
		</TooltipProvider>
	);
}

export default ChatPanel;

type HeaderProps = {
	side: UiSide;
	onSwapSide: () => void;
	onHide: () => void;
};

function Header({side, onSwapSide, onHide}: HeaderProps) {
	const awaySide = side === "right" ? "left" : "right";
	return (
		<div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-1 text-neutral-400">
			<div className="flex min-w-0 items-center gap-2">
				<span>Chat</span>
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
							className="max-sm:hidden"
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
	height: number;
	onHeightChange?: (height: number) => void;
};

function PlayerListSection({
	players,
	collapsed,
	onToggle,
	height,
	onHeightChange,
}: PlayerListSectionProps) {
	const listRef = useRef<HTMLUListElement | null>(null);
	const sorted = useMemo(
		() =>
			[...players].sort((a, b) =>
				a.name.localeCompare(b.name, undefined, {sensitivity: "base"})
			),
		[players]
	);

	const onResizePointerDown = useDragResize(
		"ns-resize",
		useCallback(() => {
			const list = listRef.current;
			if (!list || !onHeightChange) return null;
			// the section top stays put while the bottom edge follows the cursor.
			const top = list.getBoundingClientRect().top;
			return (e: PointerEvent) => onHeightChange(clampPlayerListHeight(e.clientY - top));
		}, [onHeightChange])
	);

	return (
		<div className="relative border-b border-white/10">
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
				<>
					{/* maxHeight rather than height so a short roster doesn't leave a
					    dead gap; a long one scrolls at the dragged cap. */}
					<ul
						ref={listRef}
						style={{maxHeight: height}}
						className="flex flex-col gap-0.5 overflow-y-auto px-3 pb-2"
					>
						{sorted.map((p) => (
							<li key={p.connId} className="flex items-center gap-1.5 leading-snug">
								<AvatarCell avatarId={p.avatarId} paletteId={p.paletteId} />
								<span style={{color: p.color}} className="truncate">
									{p.name}
								</span>
							</li>
						))}
					</ul>
					{onHeightChange ? (
						<div
							role="separator"
							aria-orientation="horizontal"
							onPointerDown={onResizePointerDown}
							className="absolute right-0 -bottom-1 left-0 h-2 cursor-ns-resize touch-none"
						/>
					) : null}
				</>
			)}
		</div>
	);
}
