// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";

import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import {defineConfig, globalIgnores} from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
	globalIgnores(["dist", "public"]),
	{
		files: ["**/*.{ts,tsx}"],
		extends: [
			js.configs.recommended,
			tseslint.configs.recommended,
			reactHooks.configs.flat.recommended,
			reactRefresh.configs.vite,
		],
		languageOptions: {
			globals: globals.browser,
		},
		rules: {
			"react-hooks/set-state-in-effect": "off",
			"react-refresh/only-export-components": "off",
			// house rule: no type assertions. an assertion silences the checker
			// exactly where a boundary needs one, so narrow with a guard (or build
			// the typed value) instead. `as const` is not an assertion of type and
			// stays allowed.
			"no-restricted-syntax": [
				"error",
				{
					selector: "TSAsExpression:not([typeAnnotation.typeName.name='const'])",
					message:
						"no `as` casts: narrow with a type guard or construct the typed value instead.",
				},
			],
		},
	},
	{
		// node-side code: the server, the bot harness, and the build configs. the
		// three trees under src/ are the environment boundary, and the tsconfigs
		// enforce most of it — @/shared is a root of both projects, so it is
		// type-checked with and without the DOM, and anything under @/client
		// fails the server build on its first canvas or window. this catches the
		// import earlier, and with a reason rather than a wall of TS2304s.
		files: ["src/server/**/*.ts", "scripts/**/*.ts", "*.config.ts"],
		languageOptions: {
			globals: globals.node,
		},
		rules: {
			"no-restricted-imports": [
				"error",
				{
					patterns: [
						{
							group: ["@/client", "@/client/**"],
							message:
								"browser-only: node code type-checks without the DOM. put anything both trees need in @/shared.",
						},
					],
				},
			],
		},
	},
	...storybook.configs["flat/recommended"],
]);
