import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import {defineConfig, loadEnv} from "vite";

// exposed to index.html as %VITE_BUILD_DATE% (UTC, "YYYY-MM-DD HH:MM:SS UTC") for the
// noscript crash screen.
process.env.VITE_BUILD_DATE = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";

// https://vite.dev/config/
export default defineConfig(({mode}) => {
	// load .env (empty prefix: these are plain server vars, not VITE_ ones) so the
	// proxies forward /ws and /api to the same SERVER_PORT the server binds
	// (src/server/index.ts), keeping the two in sync. target stays on loopback even if
	// the server binds a wider SERVER_HOST like 0.0.0.0, which isn't a connectable
	// address.
	const env = loadEnv(mode, process.cwd(), "");
	const serverPort = Number(env.SERVER_PORT) || 3000;
	// shared by dev (vite) and prod (vite preview): the game server never serves
	// the client, so both client servers proxy /ws and /api to it.
	// xfwd on both: the game server keys its connection caps and feedback limit
	// per client address, and behind a proxy the socket peer is this process for
	// every player. it reads the forwarded address instead (server/clientIp.ts),
	// so without this they all share one bucket.
	const proxy = {
		"/ws": {
			target: `ws://127.0.0.1:${serverPort}`,
			ws: true,
			xfwd: true,
		},
		// name validation (and any future HTTP api) lives on the server.
		"/api": {
			target: `http://127.0.0.1:${serverPort}`,
			xfwd: true,
		},
	};
	// dev (vite) and prod (vite preview) bind the same address so the client
	// url doesn't change between modes. host true binds all interfaces so other
	// machines on the lan can reach it; vite prints the network url on start.
	const clientServer = {
		host: true,
		port: 5173,
		strictPort: false,
		proxy,
	};
	return {
		plugins: [react(), tailwindcss()],
		resolve: {
			alias: {
				"@": path.resolve(__dirname, "./src"),
			},
		},
		server: clientServer,
		preview: clientServer,
	};
});
