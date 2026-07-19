import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "@/components/ui/popover";
import type {Meta, StoryObj} from "@storybook/tanstack-react";

const meta = {
	title: "UI/Popover",
	component: Popover,
	parameters: {layout: "centered"},
} satisfies Meta<typeof Popover>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
	render: () => (
		<Popover>
			<PopoverTrigger asChild>
				<Button variant="outline">Open popover</Button>
			</PopoverTrigger>
			<PopoverContent>
				<PopoverHeader>
					<PopoverTitle>Dimensions</PopoverTitle>
					<PopoverDescription>Set the dimensions for the layer.</PopoverDescription>
				</PopoverHeader>
			</PopoverContent>
		</Popover>
	),
};

export const WithForm: Story = {
	render: () => (
		<Popover>
			<PopoverTrigger asChild>
				<Button variant="outline">Edit name</Button>
			</PopoverTrigger>
			<PopoverContent>
				<PopoverHeader>
					<PopoverTitle>Display name</PopoverTitle>
					<PopoverDescription>Shown to other players in the room.</PopoverDescription>
				</PopoverHeader>
				<Input defaultValue="Marin" />
				<Button size="sm">Save</Button>
			</PopoverContent>
		</Popover>
	),
};

// `align` slides the content along the trigger's edge instead of centering it.
export const AlignStart: Story = {
	render: () => (
		<Popover>
			<PopoverTrigger asChild>
				<Button variant="outline">Aligned to start</Button>
			</PopoverTrigger>
			<PopoverContent align="start">
				<PopoverDescription>This popover is aligned to the start.</PopoverDescription>
			</PopoverContent>
		</Popover>
	),
};
