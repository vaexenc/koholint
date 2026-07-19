import {HUD_PILL_INTERACTIVE, HUD_POPOVER} from "@/components/hudPill";
import {Button} from "@/components/ui/button";
import {Popover, PopoverContent, PopoverTrigger} from "@/components/ui/popover";
import {cn} from "@/lib/utils";
import type {ConnectionStatus} from "@/lib/wsClient";
import {ChevronDown, Globe, Unplug, Users} from "lucide-react";
import {useState, type ReactNode} from "react";

export type Mode = "online" | "offline";

export type WidgetCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

// opt-in classes for pinning the widget to a fixed viewport corner. the menu
// opens itself away from the nearest edges, so a corner only needs its offset;
// consumers that place the widget elsewhere just pass their own className instead.
export const WIDGET_CORNER: Record<WidgetCorner, string> = {
	"top-left": "fixed top-2 left-2 z-10",
	"top-right": "fixed top-2 right-2 z-10",
	"bottom-left": "fixed bottom-2 left-2 z-10",
	"bottom-right": "fixed bottom-2 right-2 z-10",
};

type StatusView = {
	readonly label: string;
	readonly dotClass: string;
	readonly showCount: boolean;
};

// the collapsed pill mirrors ConnectionStatus; count only reads true once the
// snapshot stream is live, so it's hidden while connecting or dropped.
const STATUS_VIEW: Record<ConnectionStatus, StatusView> = {
	connected: {label: "Online", dotClass: "bg-green-400", showCount: true},
	connecting: {label: "Connecting…", dotClass: "bg-yellow-400", showCount: false},
	resuming: {label: "Reconnecting…", dotClass: "bg-yellow-400", showCount: false},
	closed: {label: "Disconnected", dotClass: "bg-red-400", showCount: false},
	idle: {label: "Offline", dotClass: "bg-neutral-500", showCount: false},
};

type ConnectionWidgetProps = {
	mode: Mode;
	onModeChange: (mode: Mode) => void;
	status: ConnectionStatus;
	playerCount: number;
	onReconnect?: () => void;
	// placement is the consumer's job: pass positioning classes (e.g. a
	// WIDGET_CORNER preset) or leave it to sit in normal flow.
	className?: string;
};

function ConnectionWidget({
	mode,
	onModeChange,
	status,
	playerCount,
	onReconnect,
	className,
}: ConnectionWidgetProps) {
	const [open, setOpen] = useState(false);
	const view = STATUS_VIEW[status];

	const selectOnline = () => {
		setOpen(false);
		if (mode !== "online") {
			onModeChange("online");
			return;
		}
		if (status === "closed") onReconnect?.();
	};

	const selectOffline = () => {
		setOpen(false);
		if (mode !== "offline") onModeChange("offline");
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					aria-label="connection"
					className={cn(
						HUD_PILL_INTERACTIVE,
						"gap-2 px-3 py-2 pointer-coarse:py-2.5",
						className
					)}
				>
					<span
						className={cn("size-2 shrink-0 rounded-full", view.dotClass)}
						aria-hidden
					/>
					<span>{view.label}</span>
					{view.showCount && (
						<span className="flex items-center gap-1 text-neutral-400">
							<Users className="size-3" />
							<span className="inline-block min-w-[2ch] tabular-nums text-neutral-100">
								{playerCount}
							</span>
						</span>
					)}
					<ChevronDown className="-ml-1 size-3.5 text-neutral-300" />
				</button>
			</PopoverTrigger>
			<PopoverContent
				sideOffset={4}
				className={cn(
					HUD_POPOVER,
					"flex w-max min-w-(--radix-popover-trigger-width) flex-col gap-0.5 p-1.5"
				)}
			>
				<ModeRow
					selected={mode === "online"}
					onClick={selectOnline}
					icon={<Globe className="size-3.5 opacity-80" />}
					label="Online"
				/>
				<ModeRow
					selected={mode === "offline"}
					onClick={selectOffline}
					icon={<Unplug className="size-3.5 opacity-80" />}
					label="Offline"
				/>
			</PopoverContent>
		</Popover>
	);
}

type ModeRowProps = {
	selected: boolean;
	onClick: () => void;
	icon: ReactNode;
	label: string;
};

function ModeRow({selected, onClick, icon, label}: ModeRowProps) {
	return (
		<Button
			variant="ghost"
			size="sm"
			role="menuitemradio"
			aria-checked={selected}
			onClick={onClick}
			className={cn(
				"h-auto w-full justify-start gap-2 px-2 py-1.5 font-mono text-xs font-normal hover:bg-white/5 hover:text-neutral-100",
				selected ? "bg-white/10 text-neutral-100" : "text-neutral-400"
			)}
		>
			{icon}
			<span>{label}</span>
		</Button>
	);
}

export default ConnectionWidget;
