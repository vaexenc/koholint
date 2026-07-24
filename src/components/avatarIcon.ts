import {resolveAvatarSprite} from "@/components/avatar-picker/registry";
import {spriteCanvasSize} from "@/components/SpriteCanvas";
import {computeSheetPadding, drawSpriteFrame} from "@/sprites/draw";
import {loadSpriteImage} from "@/sprites/imageCache";
import {resolvePaletteSwap} from "@/sprites/palettes";
import {recolorImageCached} from "@/sprites/paletteSwap";
import {useEffect, useState} from "react";

// data-url avatar icons, one per (avatar, palette) appearance, shared by every
// chat row and player-list row. rendering rows as <img> off this cache instead
// of a live <canvas> each matters under load: firefox reclaims churned canvases
// lazily, so a chatty room minting a canvas per message grew an ever-larger
// pool of dead surfaces, while any number of <img> rows share one decoded
// bitmap per unique source.
const cache = new Map<string, Promise<string>>();

export function loadAvatarIconUrl(avatarId: string, paletteId: string | null): Promise<string> {
	const key = `${avatarId}|${paletteId ?? ""}`;
	const existing = cache.get(key);
	if (existing) return existing;
	const promise = buildIcon(avatarId, paletteId);
	// drop failed builds so a transient image-load error doesn't poison the key.
	promise.catch(() => cache.delete(key));
	cache.set(key, promise);
	return promise;
}

// first sheet frame at scale 1, drawn with the same geometry as SpriteCanvas'
// static path so the swap is pixel-identical.
async function buildIcon(avatarId: string, paletteId: string | null): Promise<string> {
	const sprite = resolveAvatarSprite(avatarId);
	const base = sprite.sheet[0];
	if (!base) throw new Error(`empty sprite sheet for avatar ${avatarId}`);
	const image = await loadSpriteImage(sprite.imageUrl);
	const paletteSwap = resolvePaletteSwap(paletteId);
	const source =
		sprite.palette && paletteSwap
			? recolorImageCached(image, sprite.palette, paletteSwap) ?? image
			: image;
	const size = spriteCanvasSize(sprite, 1);
	const canvas = document.createElement("canvas");
	canvas.width = size.width;
	canvas.height = size.height;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("2d context unavailable");
	const padding = computeSheetPadding(sprite.sheet);
	ctx.imageSmoothingEnabled = false;
	drawSpriteFrame(
		ctx,
		source,
		{sprite: base, mirrorX: false, mirrorY: false},
		1,
		padding.x,
		padding.top,
		base.width,
		base.height
	);
	return canvas.toDataURL();
}

export function useAvatarIconUrl(avatarId: string, paletteId: string | null): string | null {
	const [url, setUrl] = useState<string | null>(null);
	useEffect(() => {
		let cancelled = false;
		loadAvatarIconUrl(avatarId, paletteId)
			.then((iconUrl) => {
				if (!cancelled) setUrl(iconUrl);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [avatarId, paletteId]);
	return url;
}
