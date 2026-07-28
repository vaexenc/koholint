import {AdminBadge} from "@/client/components/hud/AdminBadge";
import {TooltipProvider} from "@/client/components/ui/tooltip";
import type {Meta, StoryObj} from "@storybook/tanstack-react";

// AdminBadge takes no props — it's a static indicator shown only to
// admins. The decorator supplies the tooltip scope; it otherwise sits in normal
// flow (top-left) on its own, rather than in the game's bottom HUD bar.
const meta = {
	title: "Components/AdminBadge",
	component: AdminBadge,
	decorators: [
		(Story) => (
			<TooltipProvider>
				<Story />
			</TooltipProvider>
		),
	],
} satisfies Meta<typeof AdminBadge>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
