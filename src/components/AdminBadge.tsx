import {HUD_PILL, HUD_PILL_INTERACTIVE, HUD_POPOVER} from "@/components/hudPill";
import {Popover, PopoverContent, PopoverTrigger} from "@/components/ui/popover";
import {Tooltip, TooltipContent, TooltipTrigger} from "@/components/ui/tooltip";
import {cn} from "@/lib/utils";
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
					<div className={cn(HUD_PILL, "p-2 text-amber-300 pointer-coarse:p-2.5")}>
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
								"p-2 text-amber-300 pointer-coarse:p-2.5"
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
