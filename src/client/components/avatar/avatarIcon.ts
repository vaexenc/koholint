import {loadImage} from "@/client/lib/imageCache";
import {memoizeAsync} from "@/client/lib/memoizeAsync";
import {
	computeSheetPadding,
	drawSpriteFrame,
	resolveSpriteSource,
	spriteCanvasSize,
} from "@/client/sprites";
import {resolveAvatarSprite} from "@/shared/sprites/avatars";
import {resolvePaletteSwap} from "@/shared/sprites/palettes";
import {sheetFootprint} from "@/shared/sprites/sheet";
import {useEffect, useState} from "react";

// data-url avatar icons, one per (avatar, palette) appearance, shared by every
// chat row and player-list row. rendering rows as <img> off this cache instead
// of a live <canvas> each matters under load: firefox reclaims churned canvases
// lazily, so a chatty room minting a canvas per message grew an ever-larger
// pool of dead surfaces, while any number of <img> rows share one decoded
// bitmap per unique source.
export const loadAvatarIconUrl = memoizeAsync(
	(avatarId: string, paletteId: string | null) => `${avatarId}|${paletteId ?? ""}`,
	buildIcon
);

// first sheet frame at scale 1, drawn with the same geometry as SpriteCanvas'
// static path so the swap is pixel-identical.
async function buildIcon(avatarId: string, paletteId: string | null): Promise<string> {
	const sprite = resolveAvatarSprite(avatarId);
	const base = sprite.sheet[0];
	if (!base) throw new Error(`empty sprite sheet for avatar ${avatarId}`);
	const image = await loadImage(sprite.imageUrl);
	const source = resolveSpriteSource(image, sprite, resolvePaletteSwap(paletteId));
	const size = spriteCanvasSize(sprite, 1);
	const canvas = document.createElement("canvas");
	canvas.width = size.width;
	canvas.height = size.height;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("2d context unavailable");
	const padding = computeSheetPadding(sprite.sheet);
	const footprint = sheetFootprint(sprite.sheet);
	ctx.imageSmoothingEnabled = false;
	drawSpriteFrame(
		ctx,
		source,
		{sprite: base, mirrorX: false, mirrorY: false},
		1,
		padding.x,
		padding.top,
		footprint.width,
		footprint.height
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
