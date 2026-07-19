import {ScrollArea} from "@/components/ui/scroll-area";
import type {Meta, StoryObj} from "@storybook/tanstack-react";

const ITEMS = Array.from({length: 40}, (_, index) => `Item ${index + 1}`);

const LOREM = Array.from(
	{length: 12},
	() => "The island of Koholint is only a dream, and the Wind Fish must awaken."
).join(" ");

const meta = {
	title: "UI/ScrollArea",
	component: ScrollArea,
} satisfies Meta<typeof ScrollArea>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
	render: () => (
		<ScrollArea className="h-72 w-56 rounded-lg border border-border">
			<div className="flex flex-col gap-1 p-3">
				{ITEMS.map((item) => (
					<div key={item} className="text-sm">
						{item}
					</div>
				))}
			</div>
		</ScrollArea>
	),
};

export const LongText: Story = {
	render: () => (
		<ScrollArea className="h-72 w-80 rounded-lg border border-border p-4">
			<p className="text-sm leading-relaxed">{LOREM}</p>
		</ScrollArea>
	),
};
