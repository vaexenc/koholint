import {ProfileDialog} from "@/components/ProfileDialog";
import {Button} from "@/components/ui/button";
import type {Meta, StoryObj} from "@storybook/tanstack-react";
import {useState, type ComponentProps} from "react";

// the harness owns everything the dialog controls (open + the draft targets it
// commits on Save) and seeds it from the story's initial values, so a story can
// exercise the full open → edit → save round-trip. only the seed props and the
// server error are left for the story to set.
type HarnessProps = Pick<
	ComponentProps<typeof ProfileDialog>,
	"avatarId" | "paletteId" | "name" | "serverNameError"
>;

// the dialog is controlled and its edits are a draft that only lands on Save,
// so the harness owns open + avatar/palette/name state and feeds them back. it
// opens up front (so the contents are the story) but keeps its trigger button,
// as the gear does in the app.
function ProfileDialogHarness({
	avatarId: initialAvatarId,
	paletteId: initialPaletteId,
	name: initialName,
	...props
}: HarnessProps) {
	const [open, setOpen] = useState(true);
	const [avatarId, setAvatarId] = useState(initialAvatarId);
	const [paletteId, setPaletteId] = useState(initialPaletteId);
	const [name, setName] = useState(initialName);

	return (
		<ProfileDialog
			{...props}
			open={open}
			onOpenChange={setOpen}
			avatarId={avatarId}
			paletteId={paletteId}
			onChange={(a, p) => {
				setAvatarId(a);
				setPaletteId(p);
			}}
			name={initialName === undefined ? undefined : name}
			onNameChange={initialName === undefined ? undefined : setName}
			trigger={<Button>Open profile</Button>}
		/>
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
