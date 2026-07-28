import {AvatarCell} from "@/client/components/chat/AvatarCell";
import {Button} from "@/client/components/ui/button";
import {Input} from "@/client/components/ui/input";
import {Popover, PopoverContent, PopoverTrigger} from "@/client/components/ui/popover";
import {ScrollArea} from "@/client/components/ui/scroll-area";
import {ToggleGroup, ToggleGroupItem} from "@/client/components/ui/toggle-group";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/client/components/ui/tooltip";
import {useHasCoarsePointer} from "@/client/lib/hooks/useMediaQuery";
import {cn} from "@/client/lib/utils";
import {
	CHAT_SETTING_MODES,
	CHAT_SETTING_ROWS,
	chatDisplayText,
	formatChatTime,
	sanitizeChatSettings,
	type ChatSettings,
} from "@/client/settings/chatSettings";
import {CHAT_MAX_LENGTH, type ChatMessage} from "@/shared/protocol";
import {ChevronDown, Send, Settings} from "lucide-react";
import {
	memo,
	useCallback,
	useLayoutEffect,
	useRef,
	useState,
	type KeyboardEvent,
	type Ref,
} from "react";

const PIN_THRESHOLD = 8;

function presenceVerb(action: "join" | "leave" | "reconnect") {
	if (action === "join") return "joined";
	if (action === "leave") return "left";
	return "reconnected";
}

type ChatProps = {
	messages: readonly ChatMessage[];
	settings: ChatSettings;
	onSettingsChange: (settings: ChatSettings) => void;
	onSend: (text: string) => void;
	// gates the input + send button; matches connection state in online mode
	// (disabled during `connecting`/`resuming`).
	canSend: boolean;
	// lets the page focus the compose input from outside (e.g. Enter while the
	// map is focused jumps into chat).
	inputRef?: Ref<HTMLInputElement>;
	className?: string;
};

// the draft text deliberately lives in ComposeRow rather than here: keeping it
// here meant every keystroke re-rendered this component and invalidated the send
// callbacks it passed down, which is the only reason the list below needed a
// memo to stay off the typing path. this owns the scroll pin, which is the
// list's state, and nothing else the compose row can hold itself.
function Chat(props: ChatProps) {
	const {messages, settings, onSettingsChange, onSend, canSend, inputRef, className} = props;
	const [pinned, setPinned] = useState(true);
	const scrollRootRef = useRef<HTMLDivElement | null>(null);
	const viewportRef = useRef<HTMLElement | null>(null);
	useLayoutEffect(() => {
		const vp =
			scrollRootRef.current?.querySelector<HTMLElement>(
				'[data-slot="scroll-area-viewport"]'
			) ?? null;
		viewportRef.current = vp;
		if (!vp) return;
		const onScroll = () => {
			setPinned(vp.scrollHeight - vp.scrollTop - vp.clientHeight <= PIN_THRESHOLD);
		};
		vp.addEventListener("scroll", onScroll, {passive: true});
		vp.scrollTop = vp.scrollHeight;
		return () => vp.removeEventListener("scroll", onScroll);
	}, []);

	useLayoutEffect(() => {
		const vp = viewportRef.current;
		if (vp && pinned) vp.scrollTop = vp.scrollHeight;
	}, [messages, pinned]);

	const scrollToBottom = useCallback(() => {
		const vp = viewportRef.current;
		if (vp) vp.scrollTop = vp.scrollHeight;
	}, []);

	// a line the player just sent is one they want to watch land.
	const onSent = useCallback(() => setPinned(true), []);

	return (
		<TooltipProvider>
			<div className={cn("flex h-full min-h-0 flex-col", className)}>
				<ScrollArea ref={scrollRootRef} className="min-h-0 flex-1">
					<MessageList messages={messages} settings={settings} />
				</ScrollArea>
				<ComposeRow
					pinned={pinned}
					onScrollToBottom={scrollToBottom}
					settings={settings}
					onSettingsChange={onSettingsChange}
					onSend={onSend}
					onSent={onSent}
					canSend={canSend}
					inputRef={inputRef}
				/>
			</div>
		</TooltipProvider>
	);
}

export default Chat;

type MessageListProps = {
	messages: readonly ChatMessage[];
	settings: ChatSettings;
};

// isolates the scrolling list from the scroll pin: crossing the pin threshold
// re-renders Chat, and the rows shouldn't be re-mapped for it. re-renders only
// when messages or settings change.
const MessageList = memo(function MessageList({messages, settings}: MessageListProps) {
	return (
		<div className="flex flex-col gap-1 px-3 py-2">
			{messages.map((m) => (
				<ChatRow key={m.id} message={m} {...settings} />
			))}
		</div>
	);
});

type ChatRowProps = {
	message: ChatMessage;
} & ChatSettings;

// memoized so appending a message re-renders only the new row, not the whole
// list. each row mounts a canvas-backed avatar, so re-rendering every row on
// every incoming message was the dominant main-thread cost. messages are
// immutable and only appended, so a row's props stay referentially stable and
// memo skips it; rows re-render only when the chat settings actually change.
//
// every kind shares one frame — avatar cell, timestamp, body — so the kinds
// differ only in the body and in whether they read as chatter or as narration.
const ChatRow = memo(function ChatRow({
	message: m,
	timestampMode,
	avatarMode,
	presenceMode,
	obscenityMode,
}: ChatRowProps) {
	if (m.kind === "presence" && presenceMode === "off") return null;
	const ts = formatChatTime(m.timestamp, timestampMode);
	// system and presence lines are narration about the room, not conversation.
	const narration = m.kind !== "chat";
	return (
		<div
			className={cn(
				"flex items-start gap-1.5 leading-snug",
				narration && "text-neutral-500 italic"
			)}
		>
			{avatarMode === "on" &&
				// a system line has no sender, but still holds the column so bodies
				// stay aligned with the rows around it.
				(m.kind === "system" ? (
					<div className="h-5 w-5 shrink-0" />
				) : (
					<AvatarCell avatarId={m.avatarId} paletteId={m.paletteId} />
				))}
			<div className="min-w-0 flex-1 break-words">
				{ts && (
					<span
						className={cn("mr-1", narration ? "text-neutral-600" : "text-neutral-500")}
					>
						{ts}
					</span>
				)}
				{m.kind === "system" ? (
					m.text
				) : m.kind === "presence" ? (
					<>
						<span style={{color: m.color}}>{m.name}</span>
						<span> {presenceVerb(m.action)}</span>
					</>
				) : (
					<>
						<span style={{color: m.color}} className="font-semibold">
							{m.name}
						</span>
						<span className="text-neutral-400">: </span>
						<span>{chatDisplayText(m, obscenityMode)}</span>
					</>
				)}
			</div>
		</div>
	);
});

type ComposeRowProps = {
	pinned: boolean;
	onScrollToBottom: () => void;
	settings: ChatSettings;
	onSettingsChange: (settings: ChatSettings) => void;
	onSend: (text: string) => void;
	// a sent line should land in view, but the scroll pin belongs to the list, not
	// to this row — so the row reports the send rather than owning the pin.
	onSent: () => void;
	canSend: boolean;
	inputRef?: Ref<HTMLInputElement>;
};

// owns the draft text, so a keystroke re-renders this row and nothing else. its
// memo then holds for everything that isn't typing — an arriving message leaves
// every prop here referentially identical, so the popover and tooltip subtree
// below aren't rebuilt on each line of chat.
const ComposeRow = memo(function ComposeRow({
	pinned,
	onScrollToBottom,
	settings,
	onSettingsChange,
	onSend,
	onSent,
	canSend,
	inputRef,
}: ComposeRowProps) {
	const [input, setInput] = useState("");
	// touch devices tap to focus; only keyboards have an Enter to prompt for.
	const coarsePointer = useHasCoarsePointer();

	const submit = useCallback(() => {
		const text = input.trim();
		if (!text || !canSend) return;
		onSend(text);
		setInput("");
		onSent();
		// drop focus so keyboard control returns to the map (Enter re-focuses).
		if (inputRef && typeof inputRef !== "function") inputRef.current?.blur();
	}, [input, canSend, onSend, onSent, inputRef]);

	const onKeyDown = useCallback(
		(e: KeyboardEvent<HTMLInputElement>) => {
			if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
			e.preventDefault();
			submit();
		},
		[submit]
	);

	const placeholder = !canSend
		? "connecting…"
		: coarsePointer
		? "say something…"
		: "press enter to type";
	return (
		<div className="relative border-t border-white/10 p-2">
			{!pinned && (
				<button
					type="button"
					onClick={onScrollToBottom}
					className="absolute -top-9 left-1/2 flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded-full bg-black/80 text-neutral-100 shadow-md ring-1 ring-white/10 pointer-coarse:-top-11 pointer-coarse:size-9 hover:bg-black"
					aria-label="jump to bottom"
				>
					<ChevronDown className="h-4 w-4" />
				</button>
			)}
			<div className="flex items-center gap-1">
				<ChatSettingsPopover settings={settings} onChange={onSettingsChange} />
				<Input
					ref={inputRef}
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={onKeyDown}
					maxLength={CHAT_MAX_LENGTH}
					disabled={!canSend}
					placeholder={placeholder}
					// text-base below md keeps iOS from zooming the page on focus
					// (it zooms any focused input under 16px).
					className="h-8 focus:placeholder:text-transparent md:h-7 md:text-xs"
				/>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							onClick={submit}
							disabled={!canSend || !input.trim()}
							aria-label="send"
						>
							<Send />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="top">Send</TooltipContent>
				</Tooltip>
			</div>
		</div>
	);
});

type ChatSettingsPopoverProps = {
	settings: ChatSettings;
	onChange: (settings: ChatSettings) => void;
};

function ChatSettingsPopover({settings, onChange}: ChatSettingsPopoverProps) {
	return (
		<Popover>
			<Tooltip>
				<PopoverTrigger asChild>
					<TooltipTrigger asChild>
						<Button variant="ghost" size="icon-sm" aria-label="chat settings">
							<Settings />
						</Button>
					</TooltipTrigger>
				</PopoverTrigger>
				<TooltipContent side="top">Settings</TooltipContent>
			</Tooltip>
			<PopoverContent side="top" align="start" className="w-auto select-none">
				<div className="grid grid-cols-[auto_auto] items-center gap-x-3 gap-y-2 text-xs">
					{CHAT_SETTING_ROWS.map(({key, label}) => (
						<SettingRow
							key={key}
							label={label}
							modes={CHAT_SETTING_MODES[key]}
							value={settings[key]}
							// the raw patch goes back through the sanitizer, which is
							// already the one validator for a mode value, so the row
							// needs no type guard of its own.
							onSelect={(mode) =>
								onChange(sanitizeChatSettings({...settings, [key]: mode}))
							}
						/>
					))}
				</div>
			</PopoverContent>
		</Popover>
	);
}

type SettingRowProps = {
	label: string;
	modes: readonly string[];
	value: string;
	onSelect: (mode: string) => void;
};

function SettingRow({label, modes, value, onSelect}: SettingRowProps) {
	return (
		<>
			<span className="text-muted-foreground">{label}</span>
			<ToggleGroup
				type="single"
				value={value}
				size="sm"
				spacing={0}
				variant="outline"
				// deselecting sends "", which would read as "reset to default";
				// a toggle group here only ever means "pick this one".
				onValueChange={(mode) => mode && onSelect(mode)}
			>
				{modes.map((mode) => (
					<ToggleGroupItem key={mode} value={mode}>
						{mode}
					</ToggleGroupItem>
				))}
			</ToggleGroup>
		</>
	);
}
