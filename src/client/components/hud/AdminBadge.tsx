import {
	HUD_PILL,
	HUD_PILL_ICON_PADDING,
	HUD_PILL_INTERACTIVE,
	HUD_POPOVER,
} from "@/client/components/hud/hudPill";
import {Popover, PopoverContent, PopoverTrigger} from "@/client/components/ui/popover";
import {Tooltip, TooltipContent, TooltipTrigger} from "@/client/components/ui/tooltip";
import {cn} from "@/client/lib/utils";
import {ShieldCheck} from "lucide-react";
import {Children, useState, type ReactNode} from "react";

// circular badge marking the player as admin, in the same material as the
// widgets. with settings it becomes a popover holding the admin-only toggles;
// without, it's a purely informative indicator whose tooltip is its only
// interaction.
export function AdminBadge({children}: {children?: ReactNode}) {
	const [open, setOpen] = useState(false);
	const icon = <ShieldCheck className="size-4" />;

	if (Children.toArray(children).length === 0) {
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<div className={cn(HUD_PILL, HUD_PILL_ICON_PADDING, "text-amber-300")}>
						{icon}
					</div>
				</TooltipTrigger>
				<TooltipContent side="top">Admin</TooltipContent>
			</Tooltip>
		);
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<Tooltip>
				<TooltipTrigger asChild>
					<PopoverTrigger asChild>
						<button
							type="button"
							aria-label="admin settings"
							className={cn(
								HUD_PILL_INTERACTIVE,
								HUD_PILL_ICON_PADDING,
								"text-amber-300"
							)}
						>
							{icon}
						</button>
					</PopoverTrigger>
				</TooltipTrigger>
				<TooltipContent side="top">Admin</TooltipContent>
			</Tooltip>
			<PopoverContent
				sideOffset={4}
				className={cn(HUD_POPOVER, "flex w-max flex-col gap-2.5 p-2.5")}
			>
				{children}
			</PopoverContent>
		</Popover>
	);
}
