import {Checkbox} from "@/client/components/ui/checkbox";
import type {Meta, StoryObj} from "@storybook/tanstack-react";

const meta = {
	title: "UI/Checkbox",
	component: Checkbox,
	// the bare box carries no text, so an aria-label supplies its accessible name;
	// the WithLabel story pairs it with visible text instead.
	args: {
		"aria-label": "Accept",
	},
	argTypes: {
		disabled: {control: "boolean"},
	},
} satisfies Meta<typeof Checkbox>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Checked: Story = {
	args: {defaultChecked: true},
};

export const Disabled: Story = {
	args: {disabled: true},
};

export const DisabledChecked: Story = {
	args: {disabled: true, defaultChecked: true},
};

// how the app consumes it: a box plus a clickable text label, the pattern
// SettingsCheckbox packages for the settings modal's toggles.
export const WithLabel: Story = {
	render: () => (
		<label className="flex cursor-pointer items-center gap-2">
			<Checkbox defaultChecked />
			Click to move
		</label>
	),
};
