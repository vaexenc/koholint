import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import {defineConfig} from "vite";

// https://vite.dev/config/
export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
	server: {
		host: "127.0.0.1",
		port: 5173,
		proxy: {
			"/ws": {
				target: "ws://127.0.0.1:3000",
				ws: true,
			},
		},
	},
});
