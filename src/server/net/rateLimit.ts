// number of tracked keys past which stale entries are swept. keeps the map from
// growing with every IP that ever posted, without sweeping on every call.
const PRUNE_THRESHOLD = 1024;

// sliding-window budget for a single subject — one connection, one endpoint. the
// one implementation of the window; RateLimiter is this, keyed.
export class Quota {
	private readonly limit: number;
	private readonly windowMs: number;
	// attempt timestamps in arrival order. entries before `head` have aged out of
	// the window; they are skipped rather than removed, so the hot path doesn't
	// rebuild the array on every call, and the dead prefix is compacted away once
	// it dominates — which bounds the backing array at about twice the budget.
	private times: number[] = [];
	private head = 0;

	constructor(limit: number, windowMs: number) {
		this.limit = limit;
		this.windowMs = windowMs;
	}

	// records an attempt and reports whether it fits in the window's budget.
	// rejected attempts don't count against it, so a flood can't extend its own
	// lockout past the window.
	tryTake(now = Date.now()): boolean {
		while (this.head < this.times.length && now - this.times[this.head] >= this.windowMs)
			this.head++;
		if (this.times.length - this.head >= this.limit) return false;
		if (this.head > 0 && this.head >= this.times.length - this.head) {
			this.times = this.times.slice(this.head);
			this.head = 0;
		}
		this.times.push(now);
		return true;
	}

	// whether nothing has been recorded inside the window, so a keyed holder can
	// drop this subject.
	isIdle(now: number): boolean {
		return this.times.every((t) => now - t >= this.windowMs);
	}
}

// the same window, keyed by caller (client IP for the HTTP api), for endpoints
// with no connection to hang a Quota off.
export class RateLimiter {
	private readonly limit: number;
	private readonly windowMs: number;
	private readonly quotas = new Map<string, Quota>();

	constructor(limit: number, windowMs: number) {
		this.limit = limit;
		this.windowMs = windowMs;
	}

	tryTake(key: string): boolean {
		let quota = this.quotas.get(key);
		if (!quota) {
			quota = new Quota(this.limit, this.windowMs);
			this.quotas.set(key, quota);
		}
		const allowed = quota.tryTake();
		this.prune();
		return allowed;
	}

	private prune(): void {
		if (this.quotas.size <= PRUNE_THRESHOLD) return;
		const now = Date.now();
		for (const [key, quota] of this.quotas) {
			if (quota.isIdle(now)) this.quotas.delete(key);
		}
	}
}
