// one-per-key async memo: concurrent callers share the in-flight promise, and a
// rejection evicts the key so a transient failure (a network blip, a missing
// asset) doesn't poison it for the page's lifetime. every asset cache in the app
// wants exactly this, so the eviction rule lives here rather than being
// re-derived — and re-forgotten — per cache.
//
// `keyOf` maps the call's arguments onto the cache key, so a loader keeps its
// natural signature instead of packing its arguments into a string at every call
// site and unpacking them again inside.
export function memoizeAsync<A extends readonly unknown[], V>(
	keyOf: (...args: A) => string,
	build: (...args: A) => Promise<V>
): (...args: A) => Promise<V> {
	const cache = new Map<string, Promise<V>>();
	return (...args) => {
		const key = keyOf(...args);
		const existing = cache.get(key);
		if (existing) return existing;
		const promise = build(...args);
		promise.catch(() => cache.delete(key));
		cache.set(key, promise);
		return promise;
	};
}
