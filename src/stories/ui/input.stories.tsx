import {Input} from "@/components/ui/input";
import type {Meta, StoryObj} from "@storybook/tanstack-react";

const meta = {
	title: "UI/Input",
	component: Input,
	// the input is `w-full`; give every story a bounded width to size against.
	decorators: [
		(Story) => (
			<div className="w-64">
				<Story />
			</div>
		),
	],
	args: {
		placeholder: "Enter your name",
	},
	argTypes: {
		type: {
			control: "select",
			options: ["text", "email", "password", "number", "search", "file"],
		},
		disabled: {control: "boolean"},
	},
} satisfies Meta<typeof Input>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithValue: Story = {
	args: {defaultValue: "Koholint"},
};

export const Password: Story = {
	args: {type: "password", defaultValue: "hunter2"},
};

export const Search: Story = {
	args: {type: "search", placeholder: "Search…"},
};

export const File: Story = {
	args: {type: "file"},
};

export const Disabled: Story = {
	args: {disabled: true, defaultValue: "Can't touch this"},
};

// `aria-invalid` drives the destructive ring and border styling.
export const Invalid: Story = {
	args: {"aria-invalid": true, defaultValue: "not-an-email"},
};
