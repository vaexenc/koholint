import {AdminBadge} from "@/client/components/hud/AdminBadge";
import ConnectionWidget from "@/client/components/hud/ConnectionWidget";
import {HudBar} from "@/client/components/hud/HudBar";
import {PositionWidget} from "@/client/components/hud/PositionWidget";
import {ProfileWidget} from "@/client/components/hud/ProfileWidget";
import {SettingsCheckbox, SettingsWidget} from "@/client/components/hud/SettingsWidget";
import {TooltipProvider} from "@/client/components/ui/tooltip";
import {DEFAULT_KEY_BINDINGS, type KeyBindings} from "@/shared/game";
import type {Meta, StoryObj} from "@storybook/tanstack-react";
import {useState, type ReactNode} from "react";
import {fn} from "storybook/test";

// stateful movement config so the settings modal is fully interactive in the
// stories.
function StorySettingsWidget({children}: {children?: ReactNode}) {
	const [bindings, setBindings] = useState<KeyBindings>(DEFAULT_KEY_BINDINGS);
	const [clickToMove, setClickToMove] = useState(true);
	return (
		<SettingsWidget
			bindings={bindings}
			onBindingsChange={setBindings}
			clickToMove={clickToMove}
			onClickToMoveChange={setClickToMove}
		>
			{children}
		</SettingsWidget>
	);
}

// the page owns each toggle's checked state; these demo stand-ins do the same so
// the boxes actually flip when clicked in a story.
function DemoCheckbox({label, defaultChecked}: {label: string; defaultChecked?: boolean}) {
	const [checked, setChecked] = useState(defaultChecked ?? false);
	return <SettingsCheckbox label={label} checked={checked} onChange={setChecked} />;
}

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
			<StorySettingsWidget>
				<DemoCheckbox label="Camera follow" defaultChecked />
			</StorySettingsWidget>
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
			<StorySettingsWidget>
				<DemoCheckbox label="Camera follow" defaultChecked />
			</StorySettingsWidget>
			<AdminBadge />
		</HudBar>
	),
};

// the settings modal carries whatever quick toggles a page supplies above the
// always-present movement keybind editor.
export const WithAdminControls: Story = {
	render: () => (
		<StorySettingsWidget>
			<DemoCheckbox label="Camera follow" defaultChecked />
			<DemoCheckbox label="Debug overlay" />
		</StorySettingsWidget>
	),
};
