import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import {defineConfig} from "vite";

// exposed to index.html as %VITE_BUILD_DATE% (UTC, "YYYY-MM-DD HH:MM:SS UTC") for the
// noscript crash screen.
process.env.VITE_BUILD_DATE = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";

// https://vite.dev/config/
export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
	// only ever serves the client: caddy is the origin the browser talks to and
	// routes /api and /ws to the game server itself (caddy/Caddyfile.dev). host
	// true binds every interface, which is what makes this reachable from caddy's
	// container. the port is caddy's upstream, so the two move together.
	server: {
		host: true,
		port: 5173,
	},
});
