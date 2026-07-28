import {Toggle} from "@/client/components/ui/toggle";
import type {Meta, StoryObj} from "@storybook/tanstack-react";
import {Bold, Italic} from "lucide-react";

const meta = {
	title: "UI/Toggle",
	component: Toggle,
	args: {
		"aria-label": "Toggle bold",
		children: <Bold />,
		variant: "default",
		size: "default",
	},
	argTypes: {
		variant: {control: "inline-radio", options: ["default", "outline"]},
		size: {control: "inline-radio", options: ["sm", "default", "lg"]},
		disabled: {control: "boolean"},
	},
} satisfies Meta<typeof Toggle>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Outline: Story = {
	args: {variant: "outline"},
};

export const Small: Story = {
	args: {size: "sm"},
};

export const Large: Story = {
	args: {size: "lg"},
};

export const Pressed: Story = {
	args: {defaultPressed: true},
};

// visible text supplies the accessible name, so the aria-label is dropped.
export const WithText: Story = {
	args: {
		"aria-label": undefined,
		children: (
			<>
				<Italic />
				Italic
			</>
		),
	},
};

export const Disabled: Story = {
	args: {disabled: true},
};
