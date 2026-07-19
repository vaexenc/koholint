import {Button} from "@/components/ui/button";
import type {Meta, StoryObj} from "@storybook/tanstack-react";
import {Plus, Trash2} from "lucide-react";

const meta = {
	title: "UI/Button",
	component: Button,
	args: {
		children: "Button",
		variant: "default",
		size: "default",
	},
	argTypes: {
		variant: {
			control: "inline-radio",
			options: ["default", "outline", "secondary", "ghost", "destructive", "link"],
		},
		size: {
			control: "inline-radio",
			options: ["default", "xs", "sm", "lg", "icon", "icon-xs", "icon-sm", "icon-lg"],
		},
		disabled: {control: "boolean"},
	},
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Outline: Story = {
	args: {variant: "outline"},
};

export const Secondary: Story = {
	args: {variant: "secondary"},
};

export const Ghost: Story = {
	args: {variant: "ghost"},
};

export const Destructive: Story = {
	args: {variant: "destructive"},
};

export const Link: Story = {
	args: {variant: "link"},
};

export const Small: Story = {
	args: {size: "sm"},
};

export const Large: Story = {
	args: {size: "lg"},
};

export const WithIcon: Story = {
	args: {
		children: (
			<>
				<Plus />
				New
			</>
		),
	},
};

// icon-only buttons carry no text, so the label is supplied for screen readers.
export const IconOnly: Story = {
	args: {
		size: "icon",
		"aria-label": "Delete",
		children: <Trash2 />,
	},
};

export const Disabled: Story = {
	args: {disabled: true},
};
