import {Slider} from "@/components/ui/slider";
import type {Meta, StoryObj} from "@storybook/tanstack-react";

const meta = {
	title: "UI/Slider",
	component: Slider,
	// the slider is `w-full`; frame every horizontal story at a usable width.
	decorators: [
		(Story) => (
			<div className="w-72">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof Slider>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
	args: {defaultValue: [50]},
};

export const Range: Story = {
	args: {defaultValue: [25, 75]},
};

export const Stepped: Story = {
	args: {defaultValue: [40], step: 10},
};

export const Disabled: Story = {
	args: {defaultValue: [50], disabled: true},
};

export const Vertical: Story = {
	// vertical needs a bounded height rather than width, so it frames itself.
	render: () => (
		<div className="flex h-48 justify-center">
			<Slider orientation="vertical" defaultValue={[50]} />
		</div>
	),
};
