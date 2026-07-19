// url-keyed cache so every consumer (world renderer, ui previews, the
// boot-time preloader) shares one decoded image per sheet instead of
// re-fetching per entity or per mount.
const cache = new Map<string, Promise<HTMLImageElement>>();

export function loadSpriteImage(url: string): Promise<HTMLImageElement> {
	const existing = cache.get(url);
	if (existing) return existing;
	const promise = new Promise<HTMLImageElement>((resolve, reject) => {
		const image = new Image();
		image.decoding = "async";
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error(`failed to load sprite image: ${url}`));
		image.src = url;
	});
	// drop failed loads so a transient network error doesn't poison the cache.
	promise.catch(() => cache.delete(url));
	cache.set(url, promise);
	return promise;
}
