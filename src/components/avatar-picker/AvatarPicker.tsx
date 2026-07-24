import {AVATARS, type Avatar} from "@/components/avatar-picker/registry";
import {SpriteCanvas, spriteCanvasSize} from "@/components/SpriteCanvas";
import {Input} from "@/components/ui/input";
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@/components/ui/tooltip";
import {cn} from "@/lib/utils";
import {NAME_MAX_LENGTH} from "@/lib/validateName";
import {CLASSIC_CHARACTER_ANIMATIONS} from "@/sprites/animations";
import {PALETTES, type NamedPalette} from "@/sprites/palettes";
import type {CharacterAnimationName} from "@/types";
import {Check, IdCard, UserRound, type LucideIcon} from "lucide-react";
import {useEffect, useState, type ReactNode, type Ref} from "react";

const PREVIEW_POSE_INTERVAL_MS = 1000;
const PREVIEW_SCALE = 6;

// fixed slot sized to the largest avatar canvas so switching avatars never
// resizes the preview panel. sprites stand feet-aligned at its bottom.
const PREVIEW_BOX = AVATARS.reduce(
	(box, avatar) => {
		const size = spriteCanvasSize(avatar.sprite, PREVIEW_SCALE, true);
		return {
			width: Math.max(box.width, size.width),
			height: Math.max(box.height, size.height),
		};
	},
	{width: 0, height: 0}
);

// clockwise from facing-down: down → left → up → right → down → …
const PREVIEW_ANIMATION_CYCLE: readonly CharacterAnimationName[] = [
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

// corner tick marking the current selection. the ring punches it off whatever
// sits behind it (chip color or panel), so it stays legible everywhere. it
// overhangs the host's top-right corner, so hosts must not clip it: the swatch
// rows never clip, and the avatar grid reserves top/right padding for it.
function SelectedBadge({className}: {className: string}) {
	return (
		<span
			className={cn(
				"pointer-events-none absolute flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm ring-2 ring-background",
				className
			)}
		>
			<Check className="h-2.5 w-2.5" strokeWidth={3} />
		</span>
	);
}

type AvatarGridItemProps = {
	avatar: Avatar;
	selected: boolean;
	paletteSwap?: NamedPalette["palette"];
	onSelect: (id: string) => void;
};

function AvatarGridItem({avatar, selected, paletteSwap, onSelect}: AvatarGridItemProps) {
	return (
		<li className="relative">
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type="button"
						onClick={() => onSelect(avatar.id)}
						aria-pressed={selected}
						aria-label={avatar.name}
						className={
							"flex aspect-square w-full items-center justify-center overflow-hidden rounded-md border bg-black/30 transition-colors " +
							(selected
								? "border-primary/40"
								: "border-transparent hover:border-border")
						}
					>
						<SpriteCanvas sprite={avatar.sprite} scale={2} paletteSwap={paletteSwap} />
					</button>
				</TooltipTrigger>
				<TooltipContent>{avatar.name}</TooltipContent>
			</Tooltip>
			{selected ? <SelectedBadge className="-right-1.5 -top-1.5" /> : null}
		</li>
	);
}

// swatch chrome shared by the color and "off" chips; larger on coarse
// pointers for a usable touch target.
const SWATCH_CLASS =
	"relative h-6 w-6 rounded-md border border-transparent transition-opacity pointer-coarse:size-8 hover:opacity-80";

type PaletteSwatchProps = {
	palette: NamedPalette;
	selected: boolean;
	onSelect: (id: string) => void;
};

function PaletteSwatch({palette, selected, onSelect}: PaletteSwatchProps) {
	const primary = palette.palette.primary?.[0] ?? "#000";
	return (
		<button
			type="button"
			onClick={() => onSelect(palette.id)}
			aria-pressed={selected}
			title={palette.name}
			className={SWATCH_CLASS}
			style={{background: primary}}
		>
			{selected ? <SelectedBadge className="-right-1.5 -top-1.5" /> : null}
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
			className={cn(
				SWATCH_CLASS,
				"flex items-center justify-center bg-background text-[10px] text-muted-foreground"
			)}
		>
			Off
			{selected ? <SelectedBadge className="-right-1.5 -top-1.5" /> : null}
		</button>
	);
}

type SectionLabelProps = {
	icon: LucideIcon;
	children: ReactNode;
};

// shared caption for the picker's sections, so every heading keeps the same
// icon size, gap, and muted weight. `icon` is renamed to `Icon` so it can be
// rendered as a JSX element (component names must be capitalized).
function SectionLabel({icon: Icon, children}: SectionLabelProps) {
	return (
		<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
			<Icon className="h-3.5 w-3.5 shrink-0" />
			{children}
		</span>
	);
}

type NameFieldProps = {
	value: string;
	onChange: (next: string) => void;
	error?: string | null;
	inputRef?: Ref<HTMLInputElement>;
};

function NameField({value, onChange, error, inputRef}: NameFieldProps) {
	return (
		<label className="flex flex-col gap-1.5">
			<SectionLabel icon={IdCard}>Display name</SectionLabel>
			<Input
				ref={inputRef}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder="your name"
				maxLength={NAME_MAX_LENGTH}
				aria-invalid={error ? true : undefined}
			/>
			{error ? <span className="text-xs text-destructive">{error}</span> : null}
		</label>
	);
}

export type AvatarPickerProps = {
	avatarId: string;
	paletteId: string | null;
	onChange: (avatarId: string, paletteId: string | null) => void;
	// name field is shown only when both `name` and `onNameChange` are provided
	// (online mode). offline mode omits them and the picker stays name-less.
	name?: string;
	onNameChange?: (next: string) => void;
	// resolved name error, supplied by the owning surface (validation happens on
	// save).
	nameError?: string | null;
	// lets the owning surface focus the name field from outside (e.g. to pull a
	// rejection back into view).
	nameInputRef?: Ref<HTMLInputElement>;
	// drives the preview walk-cycle; pass the surrounding surface's open state so
	// we don't churn an interval while it's hidden.
	active: boolean;
};

// the shared body of the avatar/name picker: name field, avatar list, animated
// preview, palette swatches. framed by ProfileDialog — this component owns no
// dialog chrome itself.
export function AvatarPicker({
	avatarId,
	paletteId,
	onChange,
	name,
	onNameChange,
	nameError,
	nameInputRef,
	active,
}: AvatarPickerProps) {
	const selected = AVATARS.find((a) => a.id === avatarId) ?? AVATARS[0];
	const selectedPalette = paletteId ? PALETTES.find((p) => p.id === paletteId) : undefined;
	const paletteSwap = selectedPalette?.palette;
	const previewAnimation = useCycle(PREVIEW_ANIMATION_CYCLE, PREVIEW_POSE_INTERVAL_MS, active);
	const showName = name !== undefined && onNameChange !== undefined;
	return (
		<>
			{showName ? (
				<NameField
					value={name}
					onChange={onNameChange}
					error={nameError}
					inputRef={nameInputRef}
				/>
			) : null}
			<div className="flex flex-col gap-1.5">
				<SectionLabel icon={UserRound}>Avatar</SectionLabel>
				<div className="flex flex-col gap-4 rounded-lg border border-border p-3 sm:flex-row sm:gap-6 sm:p-4">
					<div className="flex flex-1 flex-col gap-4">
						<div className="flex flex-1 flex-col gap-1.5">
							<div className="flex flex-1 items-center justify-center p-2">
								<div
									className="flex items-end justify-center"
									style={{width: PREVIEW_BOX.width, height: PREVIEW_BOX.height}}
								>
									<SpriteCanvas
										sprite={selected.sprite}
										scale={PREVIEW_SCALE}
										animation={
											(selected.sprite.animations ??
												CLASSIC_CHARACTER_ANIMATIONS)[previewAnimation]
										}
										paletteSwap={paletteSwap}
										shadow
									/>
								</div>
							</div>
						</div>
						<div className="flex flex-col gap-3">
							<div className="flex flex-wrap gap-1.5">
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
					<div className="flex flex-col gap-3">
						<TooltipProvider>
							<ul className="grid w-full grid-cols-[repeat(auto-fill,minmax(3rem,1fr))] content-start gap-2 overflow-y-auto pt-2.5 pr-2.5 sm:max-h-96 sm:w-56 sm:grid-cols-4">
								{AVATARS.map((avatar) => (
									<AvatarGridItem
										key={avatar.id}
										avatar={avatar}
										selected={avatar.id === selected.id}
										paletteSwap={paletteSwap}
										onSelect={(id) => onChange(id, paletteId)}
									/>
								))}
							</ul>
						</TooltipProvider>
					</div>
				</div>
			</div>
		</>
	);
}
