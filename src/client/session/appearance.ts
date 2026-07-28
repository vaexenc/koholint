import type {CharacterRenderer} from "@/client/game";
import type {BasicCharacter} from "@/shared/game";
import type {Profile} from "@/shared/protocol";
import {resolveAvatarSprite} from "@/shared/sprites/avatars";
import {resolvePaletteSwap} from "@/shared/sprites/palettes";
import type {SpriteAsset, SpritePalette} from "@/shared/sprites/types";

// how a profile looks in the world. the one place ids are resolved to art, so
// self, remotes and the offline character can't disagree about what a profile
// looks like.
export function appearanceOf(profile: Profile): {
	sprite: SpriteAsset;
	paletteSwap: SpritePalette | undefined;
} {
	return {
		sprite: resolveAvatarSprite(profile.avatarId),
		paletteSwap: resolvePaletteSwap(profile.paletteId),
	};
}

// puts a profile's look on a character already in the world. BasicCharacter
// documents that a sprite swap has to be paired with a renderer reload; this is
// the one place that pairs them, so no caller has to remember. a sheet that
// fails to load just leaves the previous frames drawn.
export function applyAppearance(
	renderer: CharacterRenderer,
	char: BasicCharacter,
	profile: Profile
): void {
	const {sprite, paletteSwap} = appearanceOf(profile);
	char.sprite = sprite;
	char.paletteSwap = paletteSwap;
	renderer.ensureLoaded([char]).catch(() => {});
}
