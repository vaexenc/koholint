import {SpriteCanvas} from "@/components/SpriteCanvas";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	CLASSIC_CHARACTER_ANIMATIONS,
	type ClassicCharacterAnimationName,
} from "@/sprites/animations";
import {PALETTES, type NamedPalette} from "@/sprites/palettes";
import {useEffect, useState, type ReactNode} from "react";
import {AVATARS, type Avatar} from "./registry";

const PREVIEW_POSE_INTERVAL_MS = 1000;

// clockwise from facing-down: down → left → up → right → down → …
const PREVIEW_ANIMATION_CYCLE: readonly ClassicCharacterAnimationName[] = [
	"walk_down",
	"walk_left",
	"walk_up",
	"walk_right",
];

// returns the current item of `items`, advancing once every `intervalMs`
// while `active` is true. resets to index 0 each time `active` flips on so
// the cycle restarts from a known phase rather than wherever it last paused.
function useCycle<T>(items: readonly T[], intervalMs: number, active: boolean): T {
	const [index, setIndex] = useState(0);
	useEffect(() => {
		if (!active) return;
		setIndex(0);
		const id = window.setInterval(() => setIndex((i) => (i + 1) % items.length), intervalMs);
		return () => window.clearInterval(id);
	}, [active, items.length, intervalMs]);
	return items[index];
}

type AvatarListItemProps = {
	avatar: Avatar;
	selected: boolean;
	paletteSwap?: NamedPalette["palette"];
	onSelect: (id: string) => void;
};

function AvatarListItem({avatar, selected, paletteSwap, onSelect}: AvatarListItemProps) {
	return (
		<li>
			<button
				type="button"
				onClick={() => onSelect(avatar.id)}
				aria-pressed={selected}
				className={
					"flex w-full items-center gap-3 rounded-md border p-2 text-left text-sm transition-colors " +
					(selected ? "border-primary bg-muted" : "border-border hover:bg-muted/50")
				}
			>
				<SpriteCanvas sprite={avatar.sprite} scale={2} paletteSwap={paletteSwap} />
				<span>{avatar.name}</span>
			</button>
		</li>
	);
}

type PaletteSwatchProps = {
	palette: NamedPalette;
	selected: boolean;
	onSelect: (id: string) => void;
};

function PaletteSwatch({palette, selected, onSelect}: PaletteSwatchProps) {
	const primary = palette.palette.primary?.[0] ?? "#000";
	const skin = palette.palette.skin?.[0] ?? "#000";
	return (
		<button
			type="button"
			onClick={() => onSelect(palette.id)}
			aria-pressed={selected}
			title={palette.name}
			className={
				"h-8 w-8 overflow-hidden rounded-md border transition-colors " +
				(selected ? "border-primary ring-2 ring-primary" : "border-border hover:opacity-80")
			}
		>
			<span className="flex h-full w-full">
				<span className="h-full w-1/2" style={{background: primary}} />
				<span className="h-full w-1/2" style={{background: skin}} />
			</span>
		</button>
	);
}

type PaletteOffSwatchProps = {
	selected: boolean;
	onSelect: () => void;
};

function PaletteOffSwatch({selected, onSelect}: PaletteOffSwatchProps) {
	return (
		<button
			type="button"
			onClick={onSelect}
			aria-pressed={selected}
			title="No palette swap"
			className={
				"flex h-8 w-8 items-center justify-center rounded-md border bg-background text-xs text-muted-foreground transition-colors " +
				(selected ? "border-primary ring-2 ring-primary" : "border-border hover:opacity-80")
			}
		>
			Off
		</button>
	);
}

type AvatarPickerDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	avatarId: string;
	paletteId: string | null;
	onChange: (avatarId: string, paletteId: string | null) => void;
	trigger?: ReactNode;
};

export function AvatarPickerDialog({
	open,
	onOpenChange,
	avatarId,
	paletteId,
	onChange,
	trigger,
}: AvatarPickerDialogProps) {
	const selected = AVATARS.find((a) => a.id === avatarId) ?? AVATARS[0];
	const selectedPalette = paletteId ? PALETTES.find((p) => p.id === paletteId) : undefined;
	const paletteSwap = selectedPalette?.palette;
	// gated on `open` so we don't churn rAF/intervals in the background.
	const previewAnimation = useCycle(PREVIEW_ANIMATION_CYCLE, PREVIEW_POSE_INTERVAL_MS, open);
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			{trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Select an avatar</DialogTitle>
				</DialogHeader>
				<div className="flex gap-6">
					<ul className="flex w-40 flex-col gap-2">
						{AVATARS.map((avatar) => (
							<AvatarListItem
								key={avatar.id}
								avatar={avatar}
								selected={avatar.id === selected.id}
								paletteSwap={paletteSwap}
								onSelect={(id) => onChange(id, paletteId)}
							/>
						))}
					</ul>
					<div className="flex flex-1 flex-col items-center gap-4 rounded-md border border-border bg-muted/30 p-6">
						<SpriteCanvas
							sprite={selected.sprite}
							scale={8}
							animation={CLASSIC_CHARACTER_ANIMATIONS[previewAnimation]}
							paletteSwap={paletteSwap}
							shadow
						/>
						<div className="flex flex-wrap justify-center gap-2">
							<PaletteOffSwatch
								selected={paletteId === null}
								onSelect={() => onChange(avatarId, null)}
							/>
							{PALETTES.map((p) => (
								<PaletteSwatch
									key={p.id}
									palette={p}
									selected={p.id === paletteId}
									onSelect={(id) => onChange(avatarId, id)}
								/>
							))}
						</div>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
