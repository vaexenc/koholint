import {collectSpawnRegions} from "@/game/spawn";
import {CLOSE_SHUTDOWN} from "@/protocol";
import {loadTiledMap} from "@/tiled/loadMap";
import {serve} from "@hono/node-server";
import {Hono} from "hono";
import type {Server as HttpServer} from "node:http";
import path from "node:path";
import {createApi} from "./api";
import {closeDb, openDb} from "./db";
import {envInt} from "./env";
import {FeedbackStore} from "./feedback";
import {nodeMapLoaderEnv} from "./loaderEnv";
import {log} from "./log";
import {ResumeStore} from "./resume";
import {Room} from "./rooms";
import {WsServer} from "./ws";

// SERVER_-prefixed: vite reads the same .env root, so bare names wouldn't say
// which server they configure — and ambient exports (zsh sets HOST) win over
// --env-file values anyway.
const PORT = envInt("SERVER_PORT", 3000);
const HOST = process.env.SERVER_HOST ?? "127.0.0.1";
const MAP_FILE = "public/maps/overworld-map.json";
// sqlite lives here; excluded from the dev watcher (dev:server --ignore) so
// db/WAL writes don't retrigger a restart.
const DATA_DIR = "server/data";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? null;
const RESUME_SWEEP_INTERVAL_MS = 60_000;
const SHUTDOWN_GRACE_MS = 5_000;

async function main(): Promise<void> {
	const mapPath = path.resolve(MAP_FILE);
	log.info(`boot: loading map from ${mapPath}`);
	const map = await loadTiledMap(mapPath, nodeMapLoaderEnv);
	const spawns = collectSpawnRegions(map, log.warn);
	if (spawns.length === 0) {
		log.error(
			`boot: no spawn objects in ${mapPath} (need at least one object with spawn=true)`
		);
		process.exit(1);
	}
	log.info(`boot: found ${spawns.length} spawn region(s)`);
	const db = openDb(path.resolve(DATA_DIR));
	const resume = new ResumeStore(db);
	// drop rows that expired while the server was down — replaces the ttl
	// filtering the old json load() did at boot.
	resume.sweep();
	const room = new Room({map, spawns});
	room.start();
	const app = new Hono();
	app.route("/api", createApi({feedback: new FeedbackStore(db), adminToken: ADMIN_TOKEN}));
	// the client is never served from here: vite dev serves it in dev, vite
	// preview serves dist/ in prod — both proxy /api and /ws to this server.
	app.get("/", (c) => c.text("koholint server (api/ws only)"));
	const server = serve({fetch: app.fetch, port: PORT, hostname: HOST}, (info) => {
		log.info(`boot: listening on http://${info.address}:${info.port}`);
	});
	// hono's serve() defaults to a node http/1.1 server; the ws upgrade needs
	// node:http's Server, so narrow the returned ServerType union here.
	const ws = new WsServer({
		httpServer: server as HttpServer,
		room,
		resume,
		adminToken: ADMIN_TOKEN,
	});
	const sweepTimer = setInterval(() => {
		resume.sweep();
	}, RESUME_SWEEP_INTERVAL_MS);
	const shutdown = (signal: string): void => {
		log.info(`shutdown: received ${signal}, draining…`);
		clearInterval(sweepTimer);
		room.broadcast({
			type: "system",
			message: {
				id: crypto.randomUUID(),
				kind: "system",
				text: "server restarting in a moment…",
				timestamp: Date.now(),
			},
		});
		ws.shutdown("server restarting in a moment…");
		room.stop();
		setTimeout(() => {
			// disconnect handlers fire during the grace window and touch() each
			// slot's position/facing; server.close only calls back once every
			// connection has closed, so the db closes last — no write can race it.
			server.close(() => {
				closeDb(db);
				process.exit(0);
			});
		}, SHUTDOWN_GRACE_MS).unref();
	};
	// last-resort barriers so a stray throw or rejection from a socket callback
	// or timer can't take the whole process — and every connected player — down.
	// per-message failures are already contained by try/catch at the ws dispatch;
	// this only catches what slips past. registered after boot so a boot failure
	// still exits via main().catch below.
	process.on("uncaughtException", (err) => log.error("runtime: uncaughtException:", err));
	process.on("unhandledRejection", (reason) => log.error("runtime: unhandledRejection:", reason));
	process.on("SIGTERM", () => shutdown("SIGTERM"));
	process.on("SIGINT", () => shutdown("SIGINT"));
	log.info(`boot: ws close code on shutdown = ${CLOSE_SHUTDOWN}`);
}

main().catch((err) => {
	log.error("boot: fatal:", err);
	process.exit(1);
});
