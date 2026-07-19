import "../src/styles/index.css";

import type {Preview} from "@storybook/tanstack-react";

const preview: Preview = {
	parameters: {
		controls: {
			disableSaveFromUI: true,
			matchers: {
				color: /(background|color)$/i,
				date: /Date$/i,
			},
		},
		backgrounds: {
			options: {
				gray: {name: "Gray", value: "#a3a3a3"},
				light: {name: "Light", value: "#f8f8f8"},
				dark: {name: "Dark", value: "#333333"},
			},
		},
	},
	initialGlobals: {
		backgrounds: {value: "dark"},
	},
};

export default preview;
