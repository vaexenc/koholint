import type {StorybookConfig} from "@storybook/tanstack-react";

const config: StorybookConfig = {
	"stories": ["../src/**/*.mdx", "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
	"addons": ["@storybook/addon-a11y", "@storybook/addon-docs"],
	"framework": "@storybook/tanstack-react",
	"core": {
		"disableWhatsNewNotifications": true,
	},
	"features": {
		"sidebarOnboardingChecklist": false,
	},
};
export default config;
