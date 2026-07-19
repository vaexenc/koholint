import {AvatarPicker} from "@/components/avatar-picker/AvatarPicker";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {checkNameRemote} from "@/lib/checkNameRemote";
import {validateName} from "@/lib/validateName";
import {Loader2, UserRound} from "lucide-react";
import {useEffect, useRef, useState, type ReactNode} from "react";

type ProfileDialogProps = {
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
// the parent until the dialog closes. closing it any way (X / overlay / Esc /
// Enter) commits the draft; a validation rejection keeps the dialog open so the
// error can surface. the draft re-syncs to props each time the dialog opens.
export function ProfileDialog({
	open,
	onOpenChange,
	avatarId,
	paletteId,
	onChange,
	name,
	onNameChange,
	serverNameError,
	trigger,
}: ProfileDialogProps) {
	const showName = name !== undefined && onNameChange !== undefined;
	const [draftAvatarId, setDraftAvatarId] = useState(avatarId);
	const [draftPaletteId, setDraftPaletteId] = useState(paletteId);
	const [draftName, setDraftName] = useState(name ?? "");
	// name validation is deferred to Save (never while typing). this holds the
	// last save-time rejection; editing the name clears it.
	const [nameError, setNameError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	const dirty =
		draftAvatarId !== avatarId ||
		draftPaletteId !== paletteId ||
		(showName && draftName !== name);

	// closing the dialog commits the draft. a clean draft closes immediately;
	// otherwise onSave decides whether to close (success) or stay open (rejected).
	const handleOpenChange = (next: boolean) => {
		if (!next) {
			if (dirty) void onSave();
			else onOpenChange(false);
			return;
		}
		onOpenChange(next);
	};

	// snapshot props into the draft only on the open transition, so prop changes
	// while the dialog is open don't clobber in-progress edits. seed the error
	// from any standing server rejection so it shows when the dialog is reopened.
	const wasOpen = useRef(false);
	useEffect(() => {
		if (open && !wasOpen.current) {
			setDraftAvatarId(avatarId);
			setDraftPaletteId(paletteId);
			setDraftName(name ?? "");
			setNameError(showName ? serverNameError ?? null : null);
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
		// the validated name is trimmed and whitespace-normalized; propagate that
		// value, not the raw draft, so local state matches the server's copy.
		let normalizedName: string | undefined;
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
			normalizedName = local.name;
		}
		onChange(draftAvatarId, draftPaletteId);
		if (normalizedName !== undefined) onNameChange?.(normalizedName);
		onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			{trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
			<DialogContent className="flex flex-col sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2 text-lg">
						<UserRound className="h-5 w-5 shrink-0" />
						Profile
						{saving ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : null}
					</DialogTitle>
				</DialogHeader>
				{/* `contents` keeps the picker as a direct flex item of DialogContent
				    (preserving its gap) while the form still owns the inputs, so Enter
				    implicitly submits and commits the draft. only the picker wrapper
				    scrolls when the content overflows. */}
				<form
					className="contents"
					onSubmit={(e) => {
						e.preventDefault();
						void onSave();
					}}
				>
					{/* -m-1 p-1: the scroll clip (overflow-y-auto clips x too) would
					    otherwise cut off the name input's focus/invalid ring at the
					    edges; the padding gives it room, the margin keeps layout put. */}
					<div className="-m-1 flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain p-1 sm:gap-6">
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
							active={open}
						/>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
