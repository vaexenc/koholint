// caddy fronts the app and proxies /api and /ws here, so the socket peer is
// caddy, not the player — keying the connection caps or the feedback limiter on
// it would put every player in one bucket. the real address rides in
// x-forwarded-for, which is only trustworthy when the peer is a proxy we run.

const IPV4_MAPPED_PREFIX = "::ffff:";

// a fallback for running this process directly; the compose stacks pin
// TRUSTED_PROXY_IPS to caddy's address on their network instead.
const DEFAULT_TRUSTED_PROXIES = ["127.0.0.1", "::1"];

// node reports an ipv4 peer as ipv4-mapped ipv6 on a dual-stack socket, so both
// forms have to compare equal.
function normalizeIp(ip: string): string {
	const trimmed = ip.trim();
	return trimmed.startsWith(IPV4_MAPPED_PREFIX)
		? trimmed.slice(IPV4_MAPPED_PREFIX.length)
		: trimmed;
}

function parseTrustedProxies(): ReadonlySet<string> {
	const raw = process.env.TRUSTED_PROXY_IPS;
	const configured = raw && raw.trim() !== "" ? raw.split(",") : DEFAULT_TRUSTED_PROXIES;
	return new Set(configured.map(normalizeIp).filter(Boolean));
}

const TRUSTED_PROXIES = parseTrustedProxies();

// a proxy appends the address it saw to the end of the list, so with one
// trusted hop the last entry is the real client. everything to its left was
// supplied by the client itself and is spoofable — reading the first entry
// (the usual mistake) would hand an attacker the key outright.
function lastForwardedEntry(value: string | readonly string[] | undefined): string | undefined {
	if (value === undefined) return undefined;
	const joined = typeof value === "string" ? value : value.join(",");
	const entries = joined.split(",").map(normalizeIp).filter(Boolean);
	return entries.at(-1);
}

// resolves the address to key per-client limits on. `peer` is the direct socket
// address; the forwarded header is consulted only when that peer is a trusted
// proxy, so a client connecting straight to this server can't spoof its way
// into a fresh bucket.
export function resolveClientIp(
	peer: string | undefined,
	forwardedFor: string | readonly string[] | undefined
): string {
	const direct = normalizeIp(peer ?? "");
	if (!direct) return "unknown";
	if (!TRUSTED_PROXIES.has(direct)) return direct;
	return lastForwardedEntry(forwardedFor) ?? direct;
}
