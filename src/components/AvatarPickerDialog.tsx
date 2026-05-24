import {AVATARS, type Avatar} from "@/avatars/registry";
import {Button} from "@/components/ui/button";
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
import {SpriteCanvas} from "@/sprites/SpriteCanvas";
import {useEffect, useState} from "react";

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
	onSelect: (id: string) => void;
};

function AvatarListItem({avatar, selected, onSelect}: AvatarListItemProps) {
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
				<SpriteCanvas sprite={avatar.sprite} scale={2} />
				<span>{avatar.name}</span>
			</button>
		</li>
	);
}

export function AvatarPickerDialog() {
	const [open, setOpen] = useState(false);
	const [selectedId, setSelectedId] = useState<string>(AVATARS[0].id);
	const selected = AVATARS.find((a) => a.id === selectedId) ?? AVATARS[0];
	// gated on `open` so we don't churn rAF/intervals in the background.
	const previewAnimation = useCycle(PREVIEW_ANIMATION_CYCLE, PREVIEW_POSE_INTERVAL_MS, open);
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button>Pick avatar</Button>
			</DialogTrigger>
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
								onSelect={setSelectedId}
							/>
						))}
					</ul>
					<div className="flex flex-1 items-center justify-center rounded-md border border-border bg-muted/30 p-6">
						<SpriteCanvas
							sprite={selected.sprite}
							scale={8}
							animation={CLASSIC_CHARACTER_ANIMATIONS[previewAnimation]}
						/>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
