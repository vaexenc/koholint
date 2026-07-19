import {HUD_POPOVER} from "@/components/hudPill";
import {IconWidgetButton} from "@/components/IconWidgetButton";
import {Checkbox} from "@/components/ui/checkbox";
import {Popover, PopoverContent, PopoverTrigger} from "@/components/ui/popover";
import {Tooltip, TooltipContent, TooltipTrigger} from "@/components/ui/tooltip";
import {cn} from "@/lib/utils";
import {Settings} from "lucide-react";
import {Children, useState, type ReactNode} from "react";

// gear popover holding the page's quick settings.
export function SettingsWidget({children}: {children: ReactNode}) {
	const [open, setOpen] = useState(false);
	// hide the gear entirely when every setting is gated out (e.g. online and
	// not admin), so there's no button that opens an empty popover.
	if (Children.toArray(children).length === 0) return null;
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<Tooltip>
				<TooltipTrigger asChild>
					<PopoverTrigger asChild>
						<IconWidgetButton label="settings">
							<Settings />
						</IconWidgetButton>
					</PopoverTrigger>
				</TooltipTrigger>
				<TooltipContent side="top">Settings</TooltipContent>
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

export function SettingsCheckbox({
	checked,
	onChange,
	label,
}: {
	checked: boolean;
	onChange: (checked: boolean) => void;
	label: string;
}) {
	return (
		<label className="flex cursor-pointer items-center gap-2">
			<Checkbox checked={checked} onCheckedChange={(next) => onChange(next === true)} />
			{label}
		</label>
	);
}
