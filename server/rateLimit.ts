// number of tracked keys past which stale entries are swept. keeps the map from
// growing with every IP that ever posted, without sweeping on every call.
const PRUNE_THRESHOLD = 1024;

// sliding-window limiter keyed by caller (client IP for the HTTP api). the ws
// server rate-limits per connection with plain timestamp arrays; HTTP has no
// connection to hang those off, so they live here keyed instead.
export class RateLimiter {
	private readonly limit: number;
	private readonly windowMs: number;
	private readonly hits = new Map<string, number[]>();

	constructor(limit: number, windowMs: number) {
		this.limit = limit;
		this.windowMs = windowMs;
	}

	// records an attempt and reports whether it fits in the window's budget.
	// rejected attempts don't count against it, so a flood can't extend its own
	// lockout past the window.
	tryTake(key: string): boolean {
		const now = Date.now();
		const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
		const allowed = recent.length < this.limit;
		if (allowed) recent.push(now);
		this.hits.set(key, recent);
		this.prune(now);
		return allowed;
	}

	private prune(now: number): void {
		if (this.hits.size <= PRUNE_THRESHOLD) return;
		for (const [key, times] of this.hits) {
			if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(key);
		}
	}
}
