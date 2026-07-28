import {loadImage} from "@/client/lib/imageCache";
import {AVATARS} from "@/shared/sprites/avatars";

// warms the shared image cache for every avatar sheet so a character can be
// drawn the moment it appears (remote players can switch avatars at any time).
// lives on this side of the DOM line so ../avatars stays headless: the server
// reads that catalog, and decoding an image is the one thing it must not do.
export function preloadAvatarSprites(): void {
	for (const avatar of AVATARS) {
		loadImage(avatar.sprite.imageUrl).catch(() => {});
	}
}
