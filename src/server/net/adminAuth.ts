import {timingSafeEqual} from "node:crypto";

// the admin panel authenticates with a cookie rather than the localStorage
// token the game client sends over ws, since only a cookie rides along with the
// plain fetch the page makes. its value is that same ADMIN_TOKEN and it's set
// by hand in the browser (see .env.example) — there is no login endpoint, and
// the client never names this cookie.
export const ADMIN_COOKIE = "koholint_admin";

// constant-time comparison against the configured ADMIN_TOKEN, shared by the ws
// handshake (token in the hello frame) and the admin panel (token in a cookie).
// an unset token disables admin entirely — no value can match it.
export function matchesAdminToken(expected: string | null, got: string | undefined): boolean {
	if (!expected || !got) return false;
	const a = Buffer.from(expected);
	const b = Buffer.from(got);
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}
