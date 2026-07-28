import {checkNameRemote} from "@/client/api/checkNameRemote";
import {AvatarPicker} from "@/client/components/profile/AvatarPicker";
import {Dialog, DialogContent, DialogHeader, DialogTitle} from "@/client/components/ui/dialog";
import {validateName} from "@/shared/protocol/validateName";
import {Loader2, UserRound} from "lucide-react";
import {useRef, useState} from "react";

type ProfileDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	avatarId: string;
	paletteId: string | null;
	onChange: (avatarId: string, paletteId: string | null) => void;
	// online mode supplies this to show the name field; omitting it hides the
	// field entirely (offline mode keeps a single shared component, name-less).
	// one group rather than loose optionals, so "editable name" is one fact the
	// dialog reads instead of an invariant it has to reconstruct.
	nameField?: {
		readonly value: string;
		readonly onChange: (next: string) => void;
		// a rejection the server reported for the committed name, surfaced the
		// next time the dialog opens.
		readonly serverError?: string;
	};
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
	nameField,
}: ProfileDialogProps) {
	const committedName = nameField?.value;
	const serverNameError = nameField?.serverError;
	const [draftAvatarId, setDraftAvatarId] = useState(avatarId);
	const [draftPaletteId, setDraftPaletteId] = useState(paletteId);
	const [draftName, setDraftName] = useState(committedName ?? "");
	// name validation is deferred to save time (never while typing). this holds
	// the last rejection and outlives the dialog, so a name that bounced can be
	// restored — still flagged — the next time it opens. seeded at mount when
	// already open, because the open transition below can't fire then.
	const [rejection, setRejection] = useState<NameRejection | null>(
		open && serverNameError !== undefined
			? {name: committedName ?? "", reason: serverNameError}
			: null
	);
	const [saving, setSaving] = useState(false);
	// a check that outlives its dismissal still decides the name, but must not
	// close a dialog the player reopened while it was running.
	const leftDuringCheck = useRef(false);
	const nameInputRef = useRef<HTMLInputElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);

	// snapshot props into the draft only on the open transition, so prop changes
	// while the dialog is open don't clobber in-progress edits. adjusting during
	// render rather than in an effect means a reopened dialog never paints the
	// previous visit's draft first. a standing rejection is kept instead of
	// re-seeded, so the player gets their own text back; only an unrejected draft
	// follows the committed profile.
	const [wasOpen, setWasOpen] = useState(open);
	if (open !== wasOpen) {
		setWasOpen(open);
		if (open) {
			setDraftAvatarId(avatarId);
			setDraftPaletteId(paletteId);
			setSaving(false);
			if (rejection === null) {
				setDraftName(committedName ?? "");
				// a server error only exists when there is a name field at all.
				if (serverNameError !== undefined)
					setRejection({name: committedName ?? "", reason: serverNameError});
			}
		}
	}

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

	const onSave = async () => {
		if (saving) return;
		leftDuringCheck.current = false;
		commitLook();
		// captured so the narrowing survives the await below.
		const field = nameField;
		if (field && draftName !== field.value) {
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
			field.onChange(local.name);
		}
		if (!leftDuringCheck.current) onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			{/* the name field is the first focusable element, so the default
			    open-autofocus would drop a caret in it (and raise the on-screen
			    keyboard) even though most visits are here to change the avatar.
			    focusing the panel instead keeps Esc, the focus trap and tab order
			    starting from the top of the dialog. */}
			<DialogContent
				ref={contentRef}
				className="flex flex-col sm:max-w-2xl"
				onOpenAutoFocus={(e) => {
					e.preventDefault();
					contentRef.current?.focus();
				}}
			>
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
							nameField={
								nameField && {
									value: draftName,
									onChange: setDraftName,
									error: nameError,
									inputRef: nameInputRef,
								}
							}
							active={open}
						/>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
