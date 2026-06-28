import {AVATARS} from "@/components/avatar-picker/registry";
import {SpriteCanvas} from "@/components/SpriteCanvas";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Popover, PopoverContent, PopoverTrigger} from "@/components/ui/popover";
import {ScrollArea} from "@/components/ui/scroll-area";
import {ToggleGroup, ToggleGroupItem} from "@/components/ui/toggle-group";
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@/components/ui/tooltip";
import {cn} from "@/lib/utils";
import type {ChatMessage} from "@/protocol";
import {PALETTES} from "@/sprites/palettes";
import {ChevronDown, Send, Settings} from "lucide-react";
import {useLayoutEffect, useRef, useState, type KeyboardEvent} from "react";

export type {ChatMessage};

const TIMESTAMP_MODES = ["off", "24h", "12h"] as const;
const AVATAR_MODES = ["off", "on"] as const;
const PRESENCE_MODES = ["off", "on"] as const;
const OBSCENITY_MODES = ["off", "on"] as const;

export type TimestampMode = (typeof TIMESTAMP_MODES)[number];
export type AvatarMode = (typeof AVATAR_MODES)[number];
export type PresenceMode = (typeof PRESENCE_MODES)[number];
export type ObscenityMode = (typeof OBSCENITY_MODES)[number];

export type ChatSettings = {
	timestampMode: TimestampMode;
	avatarMode: AvatarMode;
	// presence join/leave/reconnect lines off by default per HANDOFF; users opt
	// in from the chat settings popover.
	presenceMode: PresenceMode;
	// "on" reveals the unfiltered text the server ships alongside the censored
	// version; off (default) keeps obscenities masked.
	obscenityMode: ObscenityMode;
};

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
	timestampMode: "24h",
	avatarMode: "on",
	presenceMode: "off",
	obscenityMode: "off",
};

const PIN_THRESHOLD = 8;

function isTimestampMode(v: string): v is TimestampMode {
	return TIMESTAMP_MODES.some((m) => m === v);
}

function isAvatarMode(v: string): v is AvatarMode {
	return AVATAR_MODES.some((m) => m === v);
}

function isPresenceMode(v: string): v is PresenceMode {
	return PRESENCE_MODES.some((m) => m === v);
}

function isObscenityMode(v: string): v is ObscenityMode {
	return OBSCENITY_MODES.some((m) => m === v);
}

function fmtTime(ts: number, mode: TimestampMode) {
	if (mode === "off") return "";
	const d = new Date(ts);
	const mm = d.getMinutes().toString().padStart(2, "0");
	if (mode === "24h") return `${d.getHours().toString().padStart(2, "0")}:${mm}`;
	const h12 = ((d.getHours() + 11) % 12) + 1;
	return `${h12}:${mm} ${d.getHours() < 12 ? "AM" : "PM"}`;
}

function resolveAvatarSprite(avatarId: string) {
	return (AVATARS.find((a) => a.id === avatarId) ?? AVATARS[0]).sprite;
}

function resolvePaletteSwap(paletteId: string | null) {
	if (!paletteId) return undefined;
	return PALETTES.find((p) => p.id === paletteId)?.palette;
}

// inline 16px avatar cell. wraps SpriteCanvas in a fixed-size flex item so
// rows stay aligned regardless of the per-sprite padding the canvas adds.
export function AvatarCell({avatarId, paletteId}: {avatarId: string; paletteId: string | null}) {
	return (
		<span className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden">
			<SpriteCanvas
				sprite={resolveAvatarSprite(avatarId)}
				scale={1}
				paletteSwap={resolvePaletteSwap(paletteId)}
			/>
		</span>
	);
}

function presenceVerb(action: "join" | "leave" | "reconnect") {
	if (action === "join") return "joined";
	if (action === "leave") return "left";
	return "reconnected";
}

type ChatProps = {
	messages: readonly ChatMessage[];
	settings?: ChatSettings;
	onSettingsChange?: (settings: ChatSettings) => void;
	onSend?: (text: string) => void;
	// gates the input + send button; matches connection state in online mode
	// (disabled during `connecting`/`resuming`).
	canSend?: boolean;
	className?: string;
};

function Chat(props: ChatProps) {
	const {
		messages,
		settings = DEFAULT_CHAT_SETTINGS,
		onSettingsChange,
		onSend,
		canSend = true,
		className,
	} = props;
	const [input, setInput] = useState("");
	const [pinned, setPinned] = useState(true);
	const scrollRootRef = useRef<HTMLDivElement | null>(null);
	const viewportRef = useRef<HTMLElement | null>(null);
	const {timestampMode, avatarMode, presenceMode, obscenityMode} = settings;

	const updateSettings = (patch: Partial<ChatSettings>) => {
		onSettingsChange?.({...settings, ...patch});
	};

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
		if (!text || !canSend) return;
		onSend?.(text);
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
						{messages.map((m) =>
							renderRow(m, timestampMode, avatarMode, presenceMode, obscenityMode)
						)}
					</div>
				</ScrollArea>
				<ComposeRow
					pinned={pinned}
					onScrollToBottom={scrollToBottom}
					settings={settings}
					updateSettings={updateSettings}
					input={input}
					setInput={setInput}
					onKeyDown={onKeyDown}
					submit={submit}
					canSend={canSend}
				/>
			</div>
		</TooltipProvider>
	);
}

export default Chat;

function renderRow(
	m: ChatMessage,
	timestampMode: TimestampMode,
	avatarMode: AvatarMode,
	presenceMode: PresenceMode,
	obscenityMode: ObscenityMode
) {
	const ts = fmtTime(m.timestamp, timestampMode);
	if (m.kind === "system") {
		return (
			<div
				key={m.id}
				className="flex items-start gap-1.5 leading-snug text-neutral-500 italic"
			>
				{avatarMode === "on" && <div className="h-5 w-5 shrink-0" />}
				<div className="min-w-0 flex-1 break-words">
					{ts && <span className="mr-1 text-neutral-600">{ts}</span>}
					{m.text}
				</div>
			</div>
		);
	}
	if (m.kind === "presence") {
		if (presenceMode === "off") return null;
		return (
			<div
				key={m.id}
				className="flex items-start gap-1.5 leading-snug text-neutral-500 italic"
			>
				{avatarMode === "on" && (
					<AvatarCell avatarId={m.avatarId} paletteId={m.paletteId} />
				)}
				<div className="min-w-0 flex-1 break-words">
					{ts && <span className="mr-1 text-neutral-600">{ts}</span>}
					<span style={{color: m.color}}>{m.name}</span>
					<span> {presenceVerb(m.action)}</span>
				</div>
			</div>
		);
	}
	const text = obscenityMode === "on" && m.rawText !== undefined ? m.rawText : m.text;
	return (
		<div key={m.id} className="flex items-start gap-1.5 leading-snug">
			{avatarMode === "on" && <AvatarCell avatarId={m.avatarId} paletteId={m.paletteId} />}
			<div className="min-w-0 flex-1 break-words">
				{ts && <span className="mr-1 text-neutral-500">{ts}</span>}
				<span style={{color: m.color}} className="font-semibold">
					{m.name}
				</span>
				<span className="text-neutral-400">: </span>
				<span>{text}</span>
			</div>
		</div>
	);
}

type ComposeRowProps = {
	pinned: boolean;
	onScrollToBottom: () => void;
	settings: ChatSettings;
	updateSettings: (patch: Partial<ChatSettings>) => void;
	input: string;
	setInput: (v: string) => void;
	onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
	submit: () => void;
	canSend: boolean;
};

function ComposeRow({
	pinned,
	onScrollToBottom,
	settings,
	updateSettings,
	input,
	setInput,
	onKeyDown,
	submit,
	canSend,
}: ComposeRowProps) {
	return (
		<div className="relative border-t border-white/10 p-2">
			{!pinned && (
				<button
					type="button"
					onClick={onScrollToBottom}
					className="absolute -top-9 left-1/2 flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded-full bg-black/80 text-neutral-100 shadow-md ring-1 ring-white/10 hover:bg-black"
					aria-label="jump to bottom"
				>
					<ChevronDown className="h-4 w-4" />
				</button>
			)}
			<div className="flex items-center gap-1">
				<SettingsPopover settings={settings} onChange={updateSettings} />
				<Input
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={onKeyDown}
					maxLength={500}
					disabled={!canSend}
					placeholder={canSend ? "say something…" : "connecting…"}
					className="h-7 text-xs"
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
}

type SettingsPopoverProps = {
	settings: ChatSettings;
	onChange: (patch: Partial<ChatSettings>) => void;
};

function SettingsPopover({settings, onChange}: SettingsPopoverProps) {
	const {timestampMode, avatarMode, presenceMode, obscenityMode} = settings;
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
			<PopoverContent side="top" align="start" className="w-auto">
				<div className="grid grid-cols-[auto_auto] items-center gap-x-3 gap-y-2 text-xs">
					<span className="text-muted-foreground">timestamps</span>
					<ToggleGroup
						type="single"
						value={timestampMode}
						size="sm"
						spacing={0}
						variant="outline"
						onValueChange={(v) => isTimestampMode(v) && onChange({timestampMode: v})}
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
						onValueChange={(v) => isAvatarMode(v) && onChange({avatarMode: v})}
					>
						{AVATAR_MODES.map((m) => (
							<ToggleGroupItem key={m} value={m}>
								{m}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
					<span className="text-muted-foreground">presence</span>
					<ToggleGroup
						type="single"
						value={presenceMode}
						size="sm"
						spacing={0}
						variant="outline"
						onValueChange={(v) => isPresenceMode(v) && onChange({presenceMode: v})}
					>
						{PRESENCE_MODES.map((m) => (
							<ToggleGroupItem key={m} value={m}>
								{m}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
					<span className="text-muted-foreground">obscenities</span>
					<ToggleGroup
						type="single"
						value={obscenityMode}
						size="sm"
						spacing={0}
						variant="outline"
						onValueChange={(v) => isObscenityMode(v) && onChange({obscenityMode: v})}
					>
						{OBSCENITY_MODES.map((m) => (
							<ToggleGroupItem key={m} value={m}>
								{m}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
				</div>
			</PopoverContent>
		</Popover>
	);
}
