import {validateFeedback} from "@/lib/feedback";
import {validateName} from "@/lib/validateName";
import {getConnInfo} from "@hono/node-server/conninfo";
import {Hono} from "hono";
import {bodyLimit} from "hono/body-limit";
import {getCookie} from "hono/cookie";
import {randomUUID} from "node:crypto";
import {ADMIN_COOKIE, matchesAdminToken} from "./adminAuth";
import type {FeedbackStore} from "./feedback";
import {checkName} from "./profanity";
import {RateLimiter} from "./rateLimit";

const FEEDBACK_MAX_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;
// how much backlog the admin panel loads at once. far above any plausible
// volume at this scale, and the panel shows newest first either way.
const FEEDBACK_LIST_LIMIT = 500;
const MAX_BODY_BYTES = 64 * 1024;

type ApiDeps = {
	readonly feedback: FeedbackStore;
	readonly adminToken: string | null;
};

// the whole HTTP api, mounted under /api. everything else the server answers is
// static assets and the ws upgrade.
export function createApi({feedback, adminToken}: ApiDeps) {
	// per-IP so one player can't bury the panel in submissions. behind the vite
	// dev proxy every request looks like loopback, which only makes the dev
	// bucket shared — deployment serves the client directly.
	const submitLimiter = new RateLimiter(FEEDBACK_MAX_PER_HOUR, HOUR_MS);
	const api = new Hono();
	// nothing posted here is anywhere near this large, and it keeps a big body
	// off the json parser — the ws path caps its frames the same way.
	api.use(bodyLimit({maxSize: MAX_BODY_BYTES}));

	// lets the settings UI surface obscenity/reserved-name rejections inline
	// before save, without shipping the obscenity package to the client.
	api.post("/validate-name", async (c) => {
		const body: unknown = await c.req.json().catch(() => null);
		const result = checkName(readString(body, "name") ?? "", false);
		return c.json(result.ok ? {ok: true} : {ok: false, reason: result.reason});
	});

	api.post("/feedback", async (c) => {
		const body: unknown = await c.req.json().catch(() => null);
		const check = validateFeedback(readString(body, "message") ?? "");
		if (!check.ok) return c.json({ok: false, reason: check.reason}, 400);
		// checked after validation so only stored rows spend the budget: a
		// rejected submission costs the sender nothing.
		if (!submitLimiter.tryTake(getConnInfo(c).remote.address ?? "unknown"))
			return c.json({ok: false, reason: "too much feedback too fast, try again later"}, 429);
		// the claimed name is unverified context for whoever reads the panel, so
		// it only has to be well-formed; a name an admin may legitimately carry
		// (reserved, e.g. "staff") is kept rather than dropped.
		const claimed = validateName(readString(body, "name") ?? "", {bypassReserved: true});
		feedback.add({
			id: randomUUID(),
			name: claimed.ok ? claimed.name : null,
			message: check.message,
			createdAtMs: Date.now(),
		});
		return c.json({ok: true});
	});

	// one gate for everything under /admin, so a route added here can't ship
	// without the cookie check.
	api.use("/admin/*", async (c, next) => {
		if (!matchesAdminToken(adminToken, getCookie(c, ADMIN_COOKIE)))
			return c.json({ok: false, reason: "unauthorized"}, 401);
		await next();
	});

	api.get("/admin/feedback", (c) =>
		c.json({ok: true, entries: feedback.list(FEEDBACK_LIST_LIMIT)})
	);

	api.post("/admin/feedback/:id/read", async (c) => {
		const body: unknown = await c.req.json().catch(() => null);
		const read = readBoolean(body, "read");
		if (read === undefined) return c.json({ok: false, reason: "read is required"}, 400);
		feedback.setRead(c.req.param("id"), read);
		return c.json({ok: true});
	});

	return api;
}

// pull a field out of an unvalidated json body. anything else — missing key,
// wrong type, non-object body — reads as absent.
function readField(body: unknown, key: string): unknown {
	if (typeof body !== "object" || body === null) return undefined;
	return Reflect.get(body, key);
}

function readString(body: unknown, key: string): string | undefined {
	const value = readField(body, key);
	return typeof value === "string" ? value : undefined;
}

function readBoolean(body: unknown, key: string): boolean | undefined {
	const value = readField(body, key);
	return typeof value === "boolean" ? value : undefined;
}
