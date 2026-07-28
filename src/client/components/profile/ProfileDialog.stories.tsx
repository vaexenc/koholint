import {ProfileDialog} from "@/client/components/profile/ProfileDialog";
import {Button} from "@/client/components/ui/button";
import type {Meta, StoryObj} from "@storybook/tanstack-react";
import {useState, type ComponentProps} from "react";

// the harness owns everything the dialog controls (open + the draft targets it
// commits on Save) and seeds it from the story's initial values, so a story can
// exercise the full open → edit → save round-trip. only the seed props and the
// server error are left for the story to set.
// the dialog takes the name field as one group; the stories set its pieces flat
// so each shows up as its own storybook control.
type HarnessProps = Pick<ComponentProps<typeof ProfileDialog>, "avatarId" | "paletteId"> & {
	// undefined is the offline case: no name field at all.
	name?: string;
	serverNameError?: string;
};

// the dialog is controlled and its edits are a draft that only lands on Save,
// so the harness owns open + avatar/palette/name state and feeds them back, the
// way the page's modal group does. it starts open, so the contents are the
// story; a Reopen button brings it back after a dismissal.
function ProfileDialogHarness({
	avatarId: initialAvatarId,
	paletteId: initialPaletteId,
	name: initialName,
	serverNameError,
}: HarnessProps) {
	const [open, setOpen] = useState(true);
	const [avatarId, setAvatarId] = useState(initialAvatarId);
	const [paletteId, setPaletteId] = useState(initialPaletteId);
	const [name, setName] = useState(initialName ?? "");

	return (
		<>
			<Button onClick={() => setOpen(true)}>Open profile</Button>
			<ProfileDialog
				open={open}
				onOpenChange={setOpen}
				avatarId={avatarId}
				paletteId={paletteId}
				onChange={(a, p) => {
					setAvatarId(a);
					setPaletteId(p);
				}}
				nameField={
					initialName === undefined
						? undefined
						: {value: name, onChange: setName, serverError: serverNameError}
				}
			/>
		</>
	);
}

const meta = {
	title: "Components/ProfileDialog",
	component: ProfileDialogHarness,
	args: {
		avatarId: "link",
		paletteId: null,
		name: "Marin",
	},
} satisfies Meta<typeof ProfileDialogHarness>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// offline mode drops the name field entirely — the picker stays name-less.
export const NoName: Story = {
	args: {name: undefined},
};

// a standing server rejection (e.g. the name is taken) shows on the field the
// moment the dialog opens, before any edit.
export const ServerNameError: Story = {
	args: {serverNameError: "That name is already taken"},
};
