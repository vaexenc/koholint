import ConnectionWidget from "@/client/components/hud/ConnectionWidget";
import {TooltipProvider} from "@/client/components/ui/tooltip";
import type {Meta, StoryObj} from "@storybook/tanstack-react";
import {fn} from "storybook/test";

// the widget is an overlay its host positions; these stories pin it to a corner
// themselves, so they render on a full-bleed canvas instead of the default
// padded frame.
const CORNER_TOP_LEFT = "fixed top-2 left-2 z-10";
const CORNER_BOTTOM_LEFT = "fixed bottom-2 left-2 z-10";

const meta = {
	title: "Components/ConnectionWidget",
	component: ConnectionWidget,
	parameters: {layout: "fullscreen"},
	// the HUD bar is the tooltip scope in the game; standalone, the stories are.
	decorators: [
		(Story) => (
			<TooltipProvider>
				<Story />
			</TooltipProvider>
		),
	],
	args: {
		mode: "online",
		onModeChange: fn(),
		status: "connected",
		playerCount: 42,
		error: null,
		className: CORNER_TOP_LEFT,
	},
	argTypes: {
		mode: {control: "inline-radio", options: ["online", "offline"]},
		status: {
			control: "select",
			options: ["idle", "connecting", "resuming", "connected", "closed"],
		},
		playerCount: {control: {type: "number", min: 0}},
	},
} satisfies Meta<typeof ConnectionWidget>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Online: Story = {};

export const Connecting: Story = {
	args: {status: "connecting"},
};

// a dropped session retrying: it reads as a plain connect, and the reason for
// the drop — with a countdown to the next attempt — is on the pill's hover.
// the timestamp is minted at render so the countdown has something to run down
// no matter when the story is opened.
export const Resuming: Story = {
	args: {status: "resuming"},
	render: (args) => (
		<ConnectionWidget
			{...args}
			error={{kind: "unreachable", nextAttemptAt: Date.now() + 8000}}
		/>
	),
};

// terminal, so nothing is retrying — the hover is all the player gets.
export const Disconnected: Story = {
	args: {status: "closed", error: {kind: "sessionTaken"}},
};

export const Offline: Story = {
	args: {mode: "offline", status: "idle"},
};

// a bottom corner: the menu flips open upward on its own, as it does on the
// online page opposite the chat panel.
export const BottomLeft: Story = {
	args: {className: CORNER_BOTTOM_LEFT},
};

// the widget needs no fixed corner: with no positioning class it sits in normal
// flow wherever its host puts it.
export const InFlow: Story = {
	args: {className: ""},
	render: (args) => (
		<div className="flex min-h-svh items-center justify-center">
			<ConnectionWidget {...args} />
		</div>
	),
};
