import {IconWidgetButton} from "@/components/IconWidgetButton";
import {MovementKeybinds} from "@/components/MovementKeybinds";
import {Checkbox} from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {Tooltip, TooltipContent, TooltipTrigger} from "@/components/ui/tooltip";
import type {KeyBindings} from "@/game";
import {useHasCoarsePointer} from "@/lib/useMediaQuery";
import {Settings} from "lucide-react";
import {Children, useState, type ReactNode} from "react";

// gear button opening the settings modal: the page's quick toggles (if any)
// plus the movement config (click-to-move, keybinds), which every page gets.
export function SettingsWidget({
	bindings,
	onBindingsChange,
	clickToMove,
	onClickToMoveChange,
	onOpenChange,
	children,
}: {
	bindings: KeyBindings;
	onBindingsChange: (next: KeyBindings) => void;
	clickToMove: boolean;
	onClickToMoveChange: (next: boolean) => void;
	// lets the page react to the modal opening, e.g. to pause player movement.
	onOpenChange?: (open: boolean) => void;
	children?: ReactNode;
}) {
	const [open, setOpen] = useState(false);
	// the movement config assumes a mouse and hardware keyboard; touch-primary
	// devices always move by hold-to-walk (the toggle doesn't apply), and key
	// capture couldn't even be cancelled without an Esc key — so they get
	// neither.
	const showMovementConfig = !useHasCoarsePointer();
	const handleOpenChange = (next: boolean) => {
		setOpen(next);
		onOpenChange?.(next);
	};
	// gated-out toggles arrive as false/null children; drop them so an empty
	// toggle group doesn't render as a stray grid row.
	const toggles = Children.toArray(children);
	// hide the gear entirely when nothing would be left in the modal, so there's
	// no button that opens an empty dialog.
	if (toggles.length === 0 && !showMovementConfig) return null;
	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<Tooltip>
				<TooltipTrigger asChild>
					<DialogTrigger asChild>
						<IconWidgetButton label="settings">
							<Settings />
						</IconWidgetButton>
					</DialogTrigger>
				</TooltipTrigger>
				<TooltipContent side="top">Settings</TooltipContent>
			</Tooltip>
			<DialogContent className="select-none sm:max-w-sm">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2 text-lg">
						<Settings className="h-5 w-5 shrink-0" />
						Settings
					</DialogTitle>
				</DialogHeader>
				{toggles.length > 0 || showMovementConfig ? (
					<div className="flex flex-col gap-2.5">
						{toggles}
						{showMovementConfig && (
							<SettingsCheckbox
								checked={clickToMove}
								onChange={onClickToMoveChange}
								label="Click to move"
							/>
						)}
					</div>
				) : null}
				{showMovementConfig && (
					<MovementKeybinds bindings={bindings} onChange={onBindingsChange} />
				)}
			</DialogContent>
		</Dialog>
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
