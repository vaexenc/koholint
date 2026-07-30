import {HUD_PILL_INTERACTIVE, HUD_POPOVER} from "@/client/components/hud/hudPill";
import {Button} from "@/client/components/ui/button";
import {Popover, PopoverContent, PopoverTrigger} from "@/client/components/ui/popover";
import {Tooltip, TooltipContent, TooltipTrigger} from "@/client/components/ui/tooltip";
import {cn} from "@/client/lib/utils";
import type {Mode} from "@/client/session/mode";
import {connectionErrorText} from "@/client/session/net/connectionErrorCopy";
import type {ConnectionError, ConnectionStatus} from "@/client/session/net/wsClient";
import {ChevronDown, Globe, Unplug, Users} from "lucide-react";
import {useEffect, useState, type ReactNode} from "react";

type StatusView = {
	readonly label: string;
	readonly dotClass: string;
	readonly showCount: boolean;
};

// the collapsed pill mirrors ConnectionStatus; count only reads true once the
// snapshot stream is live, so it's hidden while connecting or dropped. a resume
// reads the same as a first attempt — whether this tab has been in the world
// before is our bookkeeping, not something the player is waiting on.
const STATUS_VIEW: Record<ConnectionStatus, StatusView> = {
	connected: {label: "Online", dotClass: "bg-green-400", showCount: true},
	connecting: {label: "Connecting…", dotClass: "bg-yellow-400", showCount: false},
	resuming: {label: "Connecting…", dotClass: "bg-yellow-400", showCount: false},
	closed: {label: "Disconnected", dotClass: "bg-red-400", showCount: false},
	idle: {label: "Offline", dotClass: "bg-neutral-500", showCount: false},
};

type ConnectionWidgetProps = {
	mode: Mode;
	onModeChange: (mode: Mode) => void;
	status: ConnectionStatus;
	playerCount: number;
	// why the last attempt failed, surfaced on hover — the label alone can't say
	// whether we're waiting on a full server, a taken session or a dead one.
	error?: ConnectionError | null;
	onReconnect?: () => void;
	// placement is the consumer's job: the HUD row it sits in owns that, so pass
	// positioning classes only when putting it somewhere else.
	className?: string;
};

function ConnectionWidget({
	mode,
	onModeChange,
	status,
	playerCount,
	error,
	onReconnect,
	className,
}: ConnectionWidgetProps) {
	const [open, setOpen] = useState(false);
	const view = STATUS_VIEW[status];
	const reason = error ? connectionErrorText(error) : null;
	const nextAttemptAt = error?.nextAttemptAt;

	const selectOnline = () => {
		setOpen(false);
		if (mode !== "online") {
			onModeChange("online");
			return;
		}
		if (status === "closed") onReconnect?.();
	};

	// re-asserted even when already offline: while the page is offline only
	// because a join failed, picking offline is what stops it trying to get back.
	const selectOffline = () => {
		setOpen(false);
		onModeChange("offline");
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<Tooltip>
				<TooltipTrigger asChild>
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
				</TooltipTrigger>
				{/* nothing to explain while the connection is fine, so the hover
				    stays silent rather than restating the label. */}
				{reason && (
					<TooltipContent side="top">
						{reason}
						{nextAttemptAt !== undefined && <RetrySuffix at={nextAttemptAt} />}
					</TooltipContent>
				)}
			</Tooltip>
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

function secondsUntil(at: number): number {
	return Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

// seconds until `at`, live while mounted. ticks faster than it changes so the
// displayed second never lags, but only re-renders when the value moves — and
// radix unmounts closed tooltip content, so a pill at rest ticks nothing.
function useSecondsUntil(at: number): number {
	const [left, setLeft] = useState(() => secondsUntil(at));
	useEffect(() => {
		setLeft(secondsUntil(at));
		const id = setInterval(() => setLeft(secondsUntil(at)), 250);
		return () => clearInterval(id);
	}, [at]);
	return left;
}

// ", retrying in 3s" while an attempt is scheduled, ", retrying…" once it has
// fired and its outcome is still unknown (a failure brings a new timestamp).
function RetrySuffix({at}: {at: number}) {
	const left = useSecondsUntil(at);
	return <>{left > 0 ? `, retrying in ${left}s` : ", retrying…"}</>;
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
