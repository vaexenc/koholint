import {memoizeAsync} from "@/client/lib/memoizeAsync";

// url-keyed cache of decoded images, shared by everything that draws one:
// character sheets (world renderer, ui previews, the boot-time preloader), map
// tilesets, and the loader graphic. one decode per url however many consumers
// ask for it, and a failed load evicts itself so a later attempt retries.
export const loadImage = memoizeAsync(
	(url: string) => url,
	(url: string) =>
		new Promise<HTMLImageElement>((resolve, reject) => {
			const image = new Image();
			image.decoding = "async";
			image.onload = () => resolve(image);
			image.onerror = () => reject(new Error(`failed to load image: ${url}`));
			image.src = url;
		})
);
