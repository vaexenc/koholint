import {ToggleGroup, ToggleGroupItem} from "@/client/components/ui/toggle-group";
import type {Meta, StoryObj} from "@storybook/tanstack-react";
import {AlignCenter, AlignLeft, AlignRight, Bold, Italic, Underline} from "lucide-react";

const alignItems = (
	<>
		<ToggleGroupItem value="left" aria-label="Align left">
			<AlignLeft />
		</ToggleGroupItem>
		<ToggleGroupItem value="center" aria-label="Align center">
			<AlignCenter />
		</ToggleGroupItem>
		<ToggleGroupItem value="right" aria-label="Align right">
			<AlignRight />
		</ToggleGroupItem>
	</>
);

const formatItems = (
	<>
		<ToggleGroupItem value="bold" aria-label="Bold">
			<Bold />
		</ToggleGroupItem>
		<ToggleGroupItem value="italic" aria-label="Italic">
			<Italic />
		</ToggleGroupItem>
		<ToggleGroupItem value="underline" aria-label="Underline">
			<Underline />
		</ToggleGroupItem>
	</>
);

const meta = {
	title: "UI/ToggleGroup",
	component: ToggleGroup,
	// `type` is required on the group; each render sets its own, this satisfies
	// the story typing so args needn't be repeated per story.
	args: {type: "single"},
} satisfies Meta<typeof ToggleGroup>;

export default meta;

type Story = StoryObj<typeof meta>;

// single-select acts like a segmented control: exactly one item stays on.
export const Single: Story = {
	render: () => (
		<ToggleGroup type="single" defaultValue="left">
			{alignItems}
		</ToggleGroup>
	),
};

export const Multiple: Story = {
	render: () => (
		<ToggleGroup type="multiple" defaultValue={["bold"]}>
			{formatItems}
		</ToggleGroup>
	),
};

export const Outline: Story = {
	render: () => (
		<ToggleGroup type="single" variant="outline" defaultValue="center">
			{alignItems}
		</ToggleGroup>
	),
};

export const Small: Story = {
	render: () => (
		<ToggleGroup type="single" size="sm" defaultValue="center">
			{alignItems}
		</ToggleGroup>
	),
};

export const Large: Story = {
	render: () => (
		<ToggleGroup type="single" size="lg" defaultValue="center">
			{alignItems}
		</ToggleGroup>
	),
};

// spacing 0 fuses the items into one connected bar.
export const Joined: Story = {
	render: () => (
		<ToggleGroup type="single" variant="outline" spacing={0} defaultValue="center">
			{alignItems}
		</ToggleGroup>
	),
};

export const Vertical: Story = {
	render: () => (
		<ToggleGroup type="single" orientation="vertical" variant="outline" defaultValue="left">
			{alignItems}
		</ToggleGroup>
	),
};
