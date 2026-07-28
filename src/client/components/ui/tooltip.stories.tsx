import {Button} from "@/client/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/client/components/ui/tooltip";
import type {Meta, StoryObj} from "@storybook/tanstack-react";

const meta = {
	title: "UI/Tooltip",
	component: Tooltip,
	decorators: [
		(Story) => (
			<TooltipProvider>
				<Story />
			</TooltipProvider>
		),
	],
	parameters: {layout: "centered"},
} satisfies Meta<typeof Tooltip>;

export default meta;

type Story = StoryObj<typeof meta>;

const trigger = (
	<TooltipTrigger asChild>
		<Button variant="outline">Hover me</Button>
	</TooltipTrigger>
);

export const Default: Story = {
	render: () => (
		<Tooltip>
			{trigger}
			<TooltipContent>Add to library</TooltipContent>
		</Tooltip>
	),
};

export const Top: Story = {
	render: () => (
		<Tooltip>
			{trigger}
			<TooltipContent side="top">Above the trigger</TooltipContent>
		</Tooltip>
	),
};

export const Right: Story = {
	render: () => (
		<Tooltip>
			{trigger}
			<TooltipContent side="right">Right of the trigger</TooltipContent>
		</Tooltip>
	),
};

export const Bottom: Story = {
	render: () => (
		<Tooltip>
			{trigger}
			<TooltipContent side="bottom">Below the trigger</TooltipContent>
		</Tooltip>
	),
};

export const Left: Story = {
	render: () => (
		<Tooltip>
			{trigger}
			<TooltipContent side="left">Left of the trigger</TooltipContent>
		</Tooltip>
	),
};
