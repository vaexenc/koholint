import Chat, {type ChatMessage, type ChatSettings} from "@/components/Chat";
import {Button} from "@/components/ui/button";
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@/components/ui/tooltip";
import {MessageSquare, PanelRightClose} from "lucide-react";
import {
	useCallback,
	useEffect,
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

function ChatPanel({
	currentUser,
	initialMessages,
	initialSettings,
	initialWidth = DEFAULT_WIDTH,
	onSettingsChange,
	onWidthChange,
}: {
	currentUser: {name: string; color: string};
	initialMessages: ChatMessage[];
	initialSettings?: ChatSettings;
	initialWidth?: number;
	onSettingsChange?: (settings: ChatSettings) => void;
	onWidthChange?: (width: number) => void;
}) {
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

	return (
		<TooltipProvider>
			<div
				ref={panelRef}
				style={{width}}
				className="fixed top-0 right-0 bottom-0 flex flex-col bg-black/70 font-mono text-xs text-neutral-100 shadow-lg backdrop-blur"
			>
				<div className="flex items-center justify-between border-b border-white/10 px-3 py-1 text-neutral-400">
					<span>Chat</span>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								onClick={() => setHidden(true)}
								aria-label="hide chat"
							>
								<PanelRightClose />
							</Button>
						</TooltipTrigger>
						<TooltipContent side="left">Hide chat</TooltipContent>
					</Tooltip>
				</div>
				<Chat
					currentUser={currentUser}
					initialMessages={initialMessages}
					initialSettings={initialSettings}
					onSettingsChange={onSettingsChange}
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
