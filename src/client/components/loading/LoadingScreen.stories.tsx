import {LoadingScreen} from "@/client/components/loading/LoadingScreen";
import type {Meta, StoryObj} from "@storybook/tanstack-react";

// LoadingScreen pins itself to `absolute inset-0`, so the story frames it in a
// relative, full-viewport box to stand in for the page it normally overlays.
const meta = {
	title: "Components/LoadingScreen",
	component: LoadingScreen,
	parameters: {layout: "fullscreen"},
	decorators: [
		(Story) => (
			<div className="relative h-screen w-screen">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof LoadingScreen>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// retryable connection trouble, e.g. the server hit its connection cap.
export const ServerFull: Story = {
	args: {message: "Server is full, retrying..."},
};

// terminal: another window took over the session; no retry suffix.
export const SessionTaken: Story = {
	args: {message: "Session was opened somewhere else"},
};
