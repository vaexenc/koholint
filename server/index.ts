import {serve} from "@hono/node-server";
import {serveStatic} from "@hono/node-server/serve-static";
import {Hono} from "hono";
import path from "node:path";
import {existsSync} from "node:fs";
import type {Server as HttpServer} from "node:http";
import {loadTiledMap} from "@/tiled/loadMap";
import {log} from "./log";
import {nodeMapLoaderEnv} from "./loaderEnv";
import {ResumeStore} from "./resume";
import {collectSpawnRegions} from "@/game/spawn";
import {Room} from "./rooms";
import {checkName} from "./profanity";
import {CLOSE_SHUTDOWN, WsServer} from "./ws";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "127.0.0.1";
const MAP_FILE = "public/maps/overworld-map.json";
const DATA_DIR = process.env.DATA_DIR ?? "server/data";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? null;
const DIST_DIR = "dist";
const RESUME_PERSIST_INTERVAL_MS = 60_000;
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
	const resume = new ResumeStore(path.resolve(DATA_DIR));
	await resume.load();
	const room = new Room({map, spawns});
	room.start();
	const app = new Hono();
	// lets the settings UI surface obscenity/reserved-name rejections inline
	// before save, without shipping the obscenity package to the client.
	app.post("/api/validate-name", async (c) => {
		const body = await c.req.json().catch(() => null);
		const name = body && typeof body.name === "string" ? body.name : "";
		const result = checkName(name, false);
		return c.json(result.ok ? {ok: true} : {ok: false, reason: result.reason});
	});
	if (existsSync(path.resolve(DIST_DIR))) {
		log.info(`boot: serving static assets from ${DIST_DIR}/`);
		app.use("/*", serveStatic({root: `./${DIST_DIR}`}));
		// spa fallback so deep links (/, /offline, etc.) resolve to index.html.
		app.get("*", serveStatic({path: `./${DIST_DIR}/index.html`}));
	} else {
		log.info(`boot: no ${DIST_DIR}/ build present; client served by vite dev`);
		app.get("/", (c) => c.text("koholint server (dev mode — open vite at :5173)"));
	}
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
	const persistTimer = setInterval(() => {
		resume.persist().catch((err) => log.warn("resume: persist failed:", err));
		resume.sweep();
	}, RESUME_PERSIST_INTERVAL_MS);
	const shutdown = async (signal: string) => {
		log.info(`shutdown: received ${signal}, draining…`);
		clearInterval(persistTimer);
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
		try {
			await resume.persist();
		} catch (err) {
			log.warn("shutdown: resume persist failed:", err);
		}
		setTimeout(() => {
			server.close(() => process.exit(0));
		}, SHUTDOWN_GRACE_MS).unref();
	};
	process.on("SIGTERM", () => void shutdown("SIGTERM"));
	process.on("SIGINT", () => void shutdown("SIGINT"));
	log.info(`boot: ws close code on shutdown = ${CLOSE_SHUTDOWN}`);
}

main().catch((err) => {
	log.error("boot: fatal:", err);
	process.exit(1);
});
