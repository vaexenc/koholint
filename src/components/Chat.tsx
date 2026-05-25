import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Popover, PopoverContent, PopoverTrigger} from "@/components/ui/popover";
import {ScrollArea} from "@/components/ui/scroll-area";
import {ToggleGroup, ToggleGroupItem} from "@/components/ui/toggle-group";
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@/components/ui/tooltip";
import {cn} from "@/lib/utils";
import {ChevronDown, Send, Settings} from "lucide-react";
import {useLayoutEffect, useRef, useState, type KeyboardEvent} from "react";

export const CHAT_COLORS = [
	"#FF0000",
	"#FF7F50",
	"#DAA520",
	"#9ACD32",
	"#00FF7F",
	"#1E90FF",
	"#8A2BE2",
	"#FF69B4",
];

export type ChatMessage =
	| {
			id: string;
			kind: "chat";
			name: string;
			color: string;
			text: string;
			timestamp: number;
			avatarUrl: string;
	  }
	| {id: string; kind: "system"; text: string; timestamp: number};

const TIMESTAMP_MODES = ["off", "24h", "12h"] as const;
const AVATAR_MODES = ["off", "on"] as const;

export type TimestampMode = (typeof TIMESTAMP_MODES)[number];
export type AvatarMode = (typeof AVATAR_MODES)[number];

export type ChatSettings = {
	timestampMode: TimestampMode;
	avatarMode: AvatarMode;
};

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {timestampMode: "24h", avatarMode: "on"};

const PIN_THRESHOLD = 8;
const AVATAR_SRC = "/images/sprites/windfish.png";

function isTimestampMode(v: string): v is TimestampMode {
	return TIMESTAMP_MODES.some((m) => m === v);
}

function isAvatarMode(v: string): v is AvatarMode {
	return AVATAR_MODES.some((m) => m === v);
}

function fmtTime(ts: number, mode: TimestampMode) {
	if (mode === "off") return "";
	const d = new Date(ts);
	const mm = d.getMinutes().toString().padStart(2, "0");
	if (mode === "24h") return `${d.getHours().toString().padStart(2, "0")}:${mm}`;
	const h12 = ((d.getHours() + 11) % 12) + 1;
	return `${h12}:${mm} ${d.getHours() < 12 ? "AM" : "PM"}`;
}

function Chat({
	currentUser,
	initialMessages,
	initialSettings = DEFAULT_CHAT_SETTINGS,
	onSettingsChange,
	className,
}: {
	currentUser: {name: string; color: string};
	initialMessages: ChatMessage[];
	initialSettings?: ChatSettings;
	onSettingsChange?: (settings: ChatSettings) => void;
	className?: string;
}) {
	const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
	const [input, setInput] = useState("");
	const [settings, setSettings] = useState<ChatSettings>(initialSettings);
	const [pinned, setPinned] = useState(true);
	const scrollRootRef = useRef<HTMLDivElement | null>(null);
	const viewportRef = useRef<HTMLElement | null>(null);
	const {timestampMode, avatarMode} = settings;

	const updateSettings = (patch: Partial<ChatSettings>) => {
		setSettings((prev) => {
			const next = {...prev, ...patch};
			onSettingsChange?.(next);
			return next;
		});
	};

	// radix scroll-area exposes its scrollable node via data-slot; resolve it
	// once mounted so we can drive scrollTop directly and observe scroll position.
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

	const scrollToBottom = () => {
		const vp = viewportRef.current;
		if (vp) vp.scrollTop = vp.scrollHeight;
	};

	const submit = () => {
		const text = input.trim();
		if (!text) return;
		setMessages((prev) => [
			...prev,
			{
				id: crypto.randomUUID(),
				kind: "chat",
				name: currentUser.name,
				color: currentUser.color,
				text,
				timestamp: Date.now(),
				avatarUrl: AVATAR_SRC,
			},
		]);
		setInput("");
		setPinned(true);
	};

	const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
		e.preventDefault();
		submit();
	};

	return (
		<TooltipProvider>
			<div className={cn("flex h-full min-h-0 flex-col", className)}>
				<ScrollArea ref={scrollRootRef} className="min-h-0 flex-1">
					<div className="flex flex-col gap-1 px-3 py-2">
						{messages.map((m) => {
							const ts = fmtTime(m.timestamp, timestampMode);
							if (m.kind === "system")
								return (
									<div
										key={m.id}
										className="flex items-start gap-1.5 leading-snug text-neutral-500 italic"
									>
										{avatarMode === "on" && (
											<div className="h-5 w-5 shrink-0" />
										)}
										<div className="min-w-0 flex-1 break-words">
											{ts && (
												<span className="mr-1 text-neutral-600">{ts}</span>
											)}
											{m.text}
										</div>
									</div>
								);
							return (
								<div key={m.id} className="flex items-start gap-1.5 leading-snug">
									{avatarMode === "on" && (
										<img
											src={m.avatarUrl}
											alt=""
											className="h-5 w-5 shrink-0 -translate-y-1/12"
											style={{imageRendering: "pixelated"}}
										/>
									)}
									<div className="min-w-0 flex-1 break-words">
										{ts && <span className="mr-1 text-neutral-500">{ts}</span>}
										<span style={{color: m.color}} className="font-semibold">
											{m.name}
										</span>
										<span className="text-neutral-400">: </span>
										<span>{m.text}</span>
									</div>
								</div>
							);
						})}
					</div>
				</ScrollArea>
				<div className="relative border-t border-white/10 p-2">
					{!pinned && (
						<button
							type="button"
							onClick={scrollToBottom}
							className="absolute -top-9 left-1/2 flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded-full bg-black/80 text-neutral-100 shadow-md ring-1 ring-white/10 hover:bg-black"
							aria-label="jump to bottom"
						>
							<ChevronDown className="h-4 w-4" />
						</button>
					)}
					<div className="flex items-center gap-1">
						<Popover>
							<Tooltip>
								<PopoverTrigger asChild>
									<TooltipTrigger asChild>
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label="chat settings"
										>
											<Settings />
										</Button>
									</TooltipTrigger>
								</PopoverTrigger>
								<TooltipContent side="top">Settings</TooltipContent>
							</Tooltip>
							<PopoverContent side="top" align="start" className="w-auto">
								<div className="grid grid-cols-[auto_auto] items-center gap-x-3 gap-y-2 text-xs">
									<span className="text-muted-foreground">timestamps</span>
									<ToggleGroup
										type="single"
										value={timestampMode}
										size="sm"
										spacing={0}
										variant="outline"
										onValueChange={(v) =>
											isTimestampMode(v) && updateSettings({timestampMode: v})
										}
									>
										{TIMESTAMP_MODES.map((m) => (
											<ToggleGroupItem key={m} value={m}>
												{m}
											</ToggleGroupItem>
										))}
									</ToggleGroup>
									<span className="text-muted-foreground">avatars</span>
									<ToggleGroup
										type="single"
										value={avatarMode}
										size="sm"
										spacing={0}
										variant="outline"
										onValueChange={(v) =>
											isAvatarMode(v) && updateSettings({avatarMode: v})
										}
									>
										{AVATAR_MODES.map((m) => (
											<ToggleGroupItem key={m} value={m}>
												{m}
											</ToggleGroupItem>
										))}
									</ToggleGroup>
								</div>
							</PopoverContent>
						</Popover>
						<Input
							value={input}
							onChange={(e) => setInput(e.target.value)}
							onKeyDown={onKeyDown}
							maxLength={500}
							placeholder="say something…"
							className="h-7 text-xs"
						/>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									onClick={submit}
									disabled={!input.trim()}
									aria-label="send"
								>
									<Send />
								</Button>
							</TooltipTrigger>
							<TooltipContent side="top">Send</TooltipContent>
						</Tooltip>
					</div>
				</div>
			</div>
		</TooltipProvider>
	);
}

export default Chat;
