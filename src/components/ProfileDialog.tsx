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

// a rejected name paired with the exact draft text that was rejected, so the
// error clears itself the moment the field is edited.
type NameRejection = {name: string; reason: string};

// edits are a draft: the picker mutates local state only, and nothing reaches
// the parent until the dialog closes. closing it any way (X / overlay / Esc /
// Enter) commits the draft. avatar and palette always commit — they can't be
// rejected — while the name is validated first, and a rejection costs exactly
// one dismissal: enough to surface the error, after which any further dismissal
// leaves anyway. the rejected text stays in the draft, so reopening restores it
// instead of silently reverting to the committed name.
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
	// name validation is deferred to save time (never while typing). this holds
	// the last rejection and outlives the dialog, so a name that bounced can be
	// restored — still flagged — the next time it opens.
	const [rejection, setRejection] = useState<NameRejection | null>(null);
	const [saving, setSaving] = useState(false);
	// a check that outlives its dismissal still decides the name, but must not
	// close a dialog the player reopened while it was running.
	const leftDuringCheck = useRef(false);
	const nameInputRef = useRef<HTMLInputElement>(null);

	// keying the rejection to the text that produced it means editing the field
	// hides the error with no extra bookkeeping.
	const nameError = rejection !== null && rejection.name === draftName ? rejection.reason : null;

	// the look can't be rejected, so it commits on every way out; a no-op once
	// the draft matches what's already committed.
	const commitLook = () => {
		if (draftAvatarId !== avatarId || draftPaletteId !== paletteId)
			onChange(draftAvatarId, draftPaletteId);
	};

	// surfaces a rejection where the fix is — focusing also scrolls the field
	// back into view if the player had scrolled down to the avatar grid.
	const rejectName = (reason: string) => {
		setRejection({name: draftName, reason});
		nameInputRef.current?.focus();
	};

	// dismissing is never a dead end: one attempt is spent surfacing a name
	// rejection, and once that error is on screen — or a check is still running —
	// leaving always works.
	const handleOpenChange = (next: boolean) => {
		if (next) {
			onOpenChange(true);
			return;
		}
		if (nameError !== null || saving) {
			leftDuringCheck.current = saving;
			commitLook();
			onOpenChange(false);
			return;
		}
		void onSave();
	};

	// snapshot props into the draft only on the open transition, so prop changes
	// while the dialog is open don't clobber in-progress edits. a standing
	// rejection is kept instead of re-seeded, so the player gets their own text
	// back; only an unrejected draft follows the committed profile.
	const wasOpen = useRef(false);
	useEffect(() => {
		if (open && !wasOpen.current) {
			setDraftAvatarId(avatarId);
			setDraftPaletteId(paletteId);
			setSaving(false);
			if (rejection === null) {
				setDraftName(name ?? "");
				if (showName && serverNameError !== undefined)
					setRejection({name: name ?? "", reason: serverNameError});
			}
		}
		wasOpen.current = open;
	}, [open, avatarId, paletteId, name, showName, serverNameError, rejection]);

	const onSave = async () => {
		if (saving) return;
		leftDuringCheck.current = false;
		commitLook();
		if (showName && draftName !== name) {
			const local = validateName(draftName);
			if (!local.ok) {
				rejectName(local.reason);
				return;
			}
			setSaving(true);
			const remote = await checkNameRemote(local.name);
			setSaving(false);
			if (!remote.ok) {
				rejectName(remote.reason);
				return;
			}
			setRejection(null);
			// the validated name is trimmed and whitespace-normalized; propagate
			// that value, not the raw draft, so local state matches the server's.
			onNameChange?.(local.name);
		}
		if (!leftDuringCheck.current) onOpenChange(false);
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
							onNameChange={showName ? setDraftName : undefined}
							nameError={nameError}
							nameInputRef={nameInputRef}
							active={open}
						/>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
