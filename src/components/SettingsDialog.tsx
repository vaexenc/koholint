import {AvatarPicker} from "@/components/avatar-picker/AvatarPicker";
import {Button} from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {checkNameRemote} from "@/lib/checkNameRemote";
import {validateName} from "@/lib/validateName";
import {useEffect, useRef, useState, type ReactNode} from "react";

type SettingsDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	avatarId: string;
	paletteId: string | null;
	onChange: (avatarId: string, paletteId: string | null) => void;
	// online mode wires these to show the name field. omitting `name` hides the
	// field entirely (offline mode keeps a single shared component, name-less).
	name?: string;
	onNameChange?: (next: string) => void;
	serverNameError?: string;
	trigger?: ReactNode;
};

// edits are a draft: the picker mutates local state only, and nothing reaches
// the parent until Save. closing the dialog any other way (X / overlay / Esc)
// discards the draft. the draft re-syncs to props each time the dialog opens.
export function SettingsDialog({
	open,
	onOpenChange,
	avatarId,
	paletteId,
	onChange,
	name,
	onNameChange,
	serverNameError,
	trigger,
}: SettingsDialogProps) {
	const showName = name !== undefined && onNameChange !== undefined;
	const [draftAvatarId, setDraftAvatarId] = useState(avatarId);
	const [draftPaletteId, setDraftPaletteId] = useState(paletteId);
	const [draftName, setDraftName] = useState(name ?? "");
	// name validation is deferred to Save (never while typing). this holds the
	// last save-time rejection; editing the name clears it.
	const [nameError, setNameError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	// snapshot props into the draft only on the open transition, so prop changes
	// while the dialog is open don't clobber in-progress edits. seed the error
	// from any standing server rejection so it shows when Settings is reopened.
	const wasOpen = useRef(false);
	useEffect(() => {
		if (open && !wasOpen.current) {
			setDraftAvatarId(avatarId);
			setDraftPaletteId(paletteId);
			setDraftName(name ?? "");
			setNameError(showName ? (serverNameError ?? null) : null);
			setSaving(false);
		}
		wasOpen.current = open;
	}, [open, avatarId, paletteId, name, showName, serverNameError]);

	const onNameInput = (next: string) => {
		setDraftName(next);
		setNameError(null);
	};

	const onSave = async () => {
		if (saving) return;
		if (showName) {
			const local = validateName(draftName);
			if (!local.ok) {
				setNameError(local.reason);
				return;
			}
			setSaving(true);
			const remote = await checkNameRemote(local.name);
			setSaving(false);
			if (!remote.ok) {
				setNameError(remote.reason);
				return;
			}
		}
		onChange(draftAvatarId, draftPaletteId);
		if (showName) onNameChange?.(draftName);
		onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			{trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Settings</DialogTitle>
				</DialogHeader>
				{/* `contents` keeps the picker + footer as direct grid items of
				    DialogContent (preserving its gap) while the form still owns the
				    inputs, so Enter implicitly submits and triggers Save. */}
				<form
					className="contents"
					onSubmit={(e) => {
						e.preventDefault();
						void onSave();
					}}
				>
					<AvatarPicker
						avatarId={draftAvatarId}
						paletteId={draftPaletteId}
						onChange={(a, p) => {
							setDraftAvatarId(a);
							setDraftPaletteId(p);
						}}
						name={showName ? draftName : undefined}
						onNameChange={showName ? onNameInput : undefined}
						nameError={nameError}
						nameChecking={saving}
						active={open}
					/>
					<DialogFooter>
						<Button type="submit" disabled={saving}>
							Save
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
