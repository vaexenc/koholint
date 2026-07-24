import {MovementKeybinds} from "@/components/MovementKeybinds";
import {DEFAULT_KEY_BINDINGS, type KeyBindings} from "@/game";
import type {Meta, StoryObj} from "@storybook/tanstack-react";
import {useState} from "react";

// the editor is controlled and rebinding is a live round-trip — arm a cell, then
// the next keypress lands in it — so the harness owns the bindings and feeds each
// change back, letting a story exercise capture, reassignment, clearing and reset
// end to end.
function MovementKeybindsHarness({bindings: initial}: {bindings: KeyBindings}) {
	const [bindings, setBindings] = useState(initial);
	return <MovementKeybinds bindings={bindings} onChange={setBindings} />;
}

// the grid lives in the settings modal (~sm wide); frame it at that width.
const meta = {
	title: "Components/MovementKeybinds",
	component: MovementKeybindsHarness,
	decorators: [
		(Story) => (
			<div className="w-80">
				<Story />
			</div>
		),
	],
	args: {
		bindings: DEFAULT_KEY_BINDINGS,
	},
} satisfies Meta<typeof MovementKeybindsHarness>;

export default meta;

type Story = StoryObj<typeof meta>;

// the stock layout: wasd plus arrow keys fill both slots per direction, so Reset
// stays disabled until an edit diverges from it.
export const Default: Story = {};

// one key per direction (esdf): the second slots read as empty "—" cells and,
// since this differs from the default, Reset is live.
export const Customized: Story = {
	args: {
		bindings: {
			up: ["e"],
			down: ["d"],
			left: ["s"],
			right: ["f"],
			zoomIn: ["r"],
			zoomOut: ["w"],
		},
	},
};
