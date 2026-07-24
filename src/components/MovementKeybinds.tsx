import {Button} from "@/components/ui/button";
import {DEFAULT_KEY_BINDINGS, type KeyBindings} from "@/game";
import {
	assignMovementKey,
	clearMovementKey,
	movementKeyLabel,
	movementSlots,
	sameMovementBindings,
	type MovementAction,
	type MovementSlot,
} from "@/lib/movementBindings";
import {cn} from "@/lib/utils";
import {Fragment, useEffect, useState} from "react";

const ROWS: readonly {action: MovementAction; label: string}[] = [
	{action: "up", label: "Up"},
	{action: "down", label: "Down"},
	{action: "left", label: "Left"},
	{action: "right", label: "Right"},
	{action: "zoomIn", label: "Zoom in"},
	{action: "zoomOut", label: "Zoom out"},
];

// grid of per-direction key cells. clicking a cell arms capture: the next
// keydown — grabbed on window in the capture phase, so neither the dialog's
// own key handling (e.g. Escape-to-close) nor anything below sees it — lands
// in that cell; Escape or clicking the cell again backs out, Backspace/Delete
// empties the cell. a key already bound elsewhere moves rather than
// duplicates. keyboard-only by nature — the settings modal hides it on
// touch-primary devices.
export function MovementKeybinds({
	bindings,
	onChange,
}: {
	bindings: KeyBindings;
	onChange: (next: KeyBindings) => void;
}) {
	const [capture, setCapture] = useState<MovementSlot | null>(null);

	useEffect(() => {
		if (!capture) return;
		const onKeyDown = (e: KeyboardEvent) => {
			e.preventDefault();
			e.stopPropagation();
			if (e.key === "Escape") {
				setCapture(null);
				return;
			}
			if (e.key === "Backspace" || e.key === "Delete") {
				onChange(clearMovementKey(bindings, capture));
			} else {
				onChange(assignMovementKey(bindings, capture, e.key.toLowerCase()));
			}
			setCapture(null);
		};
		window.addEventListener("keydown", onKeyDown, {capture: true});
		return () => window.removeEventListener("keydown", onKeyDown, {capture: true});
	}, [capture, bindings, onChange]);

	return (
		<div className="flex flex-col gap-2.5">
			<div className="flex items-center justify-between">
				<h3 className="font-medium">Keybinds</h3>
				<Button
					variant="ghost"
					size="xs"
					disabled={sameMovementBindings(bindings, DEFAULT_KEY_BINDINGS)}
					onClick={() => {
						setCapture(null);
						onChange(DEFAULT_KEY_BINDINGS);
					}}
				>
					Reset
				</Button>
			</div>
			<div className="grid grid-cols-[auto_1fr_1fr] items-center gap-x-2 gap-y-1.5">
				{ROWS.map(({action, label}) => (
					<Fragment key={action}>
						<span className="text-muted-foreground">{label}</span>
						{movementSlots(bindings, action).map((key, slot) => {
							const capturing =
								capture !== null &&
								capture.action === action &&
								capture.slot === slot;
							return (
								<Button
									key={slot}
									variant="outline"
									size="sm"
									aria-label={`${label} key ${slot + 1}`}
									className={cn(
										"w-full font-mono",
										capturing && "border-ring ring-3 ring-ring/50",
										!capturing && key === null && "text-muted-foreground"
									)}
									onClick={() => setCapture(capturing ? null : {action, slot})}
								>
									{capturing ? "…" : key === null ? "—" : movementKeyLabel(key)}
								</Button>
							);
						})}
					</Fragment>
				))}
			</div>
			<p className="text-xs text-muted-foreground">
				{capture
					? "Press a key to bind it — Esc cancels, Backspace clears."
					: "Click a slot to rebind. Up to two keys per action."}
			</p>
		</div>
	);
}
