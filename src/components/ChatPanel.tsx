import Chat, {AvatarCell, type ChatMessage, type ChatSettings} from "@/components/Chat";
import {Button} from "@/components/ui/button";
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@/components/ui/tooltip";
import {cn} from "@/lib/utils";
import type {ConnectionStatus} from "@/lib/wsClient";
import type {ConnId} from "@/protocol";
import {ChevronRight, MessageSquare, PanelRightClose} from "lucide-react";
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
const DEFAULT_WIDTH = 356;

function clampWidth(w: number) {
	return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w));
}

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
	initialWidth?: number;
	onWidthChange?: (width: number) => void;
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
	initialWidth = DEFAULT_WIDTH,
	onWidthChange,
	status,
	players,
	playerListCollapsed = false,
	onPlayerListCollapsedChange,
	canSend,
}: ChatPanelProps) {
	const [width, setWidthState] = useState(() => clampWidth(initialWidth));
	const [hidden, setHidden] = useState(false);
	const setWidth = useCallback(
		(w: number) => {
			const next = clampWidth(w);
			setWidthState(next);
			onWidthChange?.(next);
		},
		[onWidthChange]
	);
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
		const right = panel.getBoundingClientRect().right;
		const onMove = (e: PointerEvent) => {
			setWidth(clampWidth(right - e.clientX));
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
	}, [resizing, setWidth]);

	if (hidden) {
		return (
			<TooltipProvider>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							onClick={() => setHidden(false)}
							aria-label="show chat"
							className="fixed top-2 right-2 z-10 bg-black/70 text-neutral-100 shadow-lg backdrop-blur hover:bg-black/80"
						>
							<MessageSquare />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="left">Show chat</TooltipContent>
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
				className="fixed top-0 right-0 bottom-0 flex flex-col bg-black/70 font-mono text-xs text-neutral-100 shadow-lg backdrop-blur"
			>
				<Header
					status={status}
					playerCount={players?.length}
					onHide={() => setHidden(true)}
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
					className="absolute top-0 -left-1 h-full w-2 cursor-ew-resize touch-none"
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
	onHide: () => void;
};

function Header({status, playerCount, onHide}: HeaderProps) {
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
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						onClick={onHide}
						aria-label="hide chat"
					>
						<PanelRightClose />
					</Button>
				</TooltipTrigger>
				<TooltipContent side="left">Hide chat</TooltipContent>
			</Tooltip>
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
