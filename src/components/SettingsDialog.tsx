import {AvatarPicker} from "@/components/avatar-picker/AvatarPicker";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {type ReactNode} from "react";

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
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			{trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Settings</DialogTitle>
				</DialogHeader>
				<AvatarPicker
					avatarId={avatarId}
					paletteId={paletteId}
					onChange={onChange}
					name={name}
					onNameChange={onNameChange}
					serverNameError={serverNameError}
					active={open}
				/>
			</DialogContent>
		</Dialog>
	);
}
