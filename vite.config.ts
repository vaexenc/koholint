import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import {defineConfig, loadEnv} from "vite";

// https://vite.dev/config/
export default defineConfig(({mode}) => {
	// load .env (empty prefix: these are plain server vars, not VITE_ ones) so the
	// dev proxy forwards /ws to the same PORT the server binds (server/index.ts),
	// keeping the two in sync. target stays on loopback even if the server binds a
	// wider HOST like 0.0.0.0, which isn't a connectable address.
	const env = loadEnv(mode, process.cwd(), "");
	const serverPort = Number(env.PORT) || 3000;
	return {
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
					target: `ws://127.0.0.1:${serverPort}`,
					ws: true,
				},
			},
		},
	};
});
