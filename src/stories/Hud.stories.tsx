import {AdminBadge} from "@/components/AdminBadge";
import ConnectionWidget from "@/components/ConnectionWidget";
import {HudBar} from "@/components/HudBar";
import {PositionWidget} from "@/components/PositionWidget";
import {ProfileWidget} from "@/components/ProfileWidget";
import {SettingsWidget} from "@/components/SettingsWidget";
import {TooltipProvider} from "@/components/ui/tooltip";
import type {Meta, StoryObj} from "@storybook/tanstack-react";
import {fn} from "storybook/test";

// the widgets only need a tooltip scope from their surroundings; the decorator
// supplies that and otherwise lets them sit in normal flow (top-left) on their
// own, rather than in the game's bottom HUD bar.
const meta = {
	title: "Components/Hud",
	decorators: [
		(Story) => (
			<TooltipProvider>
				<div className="flex items-center gap-1">
					<Story />
				</div>
			</TooltipProvider>
		),
	],
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

// all three widgets side by side, as the pages arrange them.
export const AllWidgets: Story = {
	render: () => (
		<>
			<PositionWidget playerTile={{x: 42, y: 17}} />
			<ProfileWidget onOpenProfile={fn()} />
			<SettingsWidget>
				<label className="flex items-center gap-2">
					<input type="checkbox" defaultChecked />
					Camera follow
				</label>
			</SettingsWidget>
		</>
	),
};

// before the first position sample arrives the readout shows an em dash and the
// copy affordance is gone.
export const NoPosition: Story = {
	render: () => <PositionWidget playerTile={null} />,
};

// the full bottom bar as the online page composes it for an admin: connection
// pill, the split position/profile/settings widgets, and the admin badge, all
// in the shared pill material. rendered fullscreen since HudBar is fixed to a
// viewport corner.
export const FullBar: Story = {
	parameters: {layout: "fullscreen"},
	render: () => (
		<HudBar>
			<ConnectionWidget
				mode="online"
				onModeChange={fn()}
				status="connected"
				playerCount={42}
			/>
			<PositionWidget playerTile={{x: 42, y: 17}} />
			<ProfileWidget onOpenProfile={fn()} />
			<SettingsWidget>
				<label className="flex items-center gap-2">
					<input type="checkbox" defaultChecked />
					Camera follow
				</label>
			</SettingsWidget>
			<AdminBadge />
		</HudBar>
	),
};

// the gear popover carries whatever quick settings a page supplies; here it also
// holds an admin-only debug toggle, as the online page does.
export const WithAdminControls: Story = {
	render: () => (
		<SettingsWidget>
			<label className="flex items-center gap-2">
				<input type="checkbox" defaultChecked />
				Camera follow
			</label>
			<label className="flex items-center gap-2">
				<input type="checkbox" />
				Debug overlay
			</label>
		</SettingsWidget>
	),
};
