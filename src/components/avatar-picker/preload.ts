import {AVATARS} from "@/components/avatar-picker/registry";
import {loadSpriteImage} from "@/sprites/imageCache";

// warms the shared image cache for every avatar sheet so a character can be
// drawn the moment it appears (remote players can switch avatars at any time).
// lives outside the registry so that stays DOM-free for the server.
export function preloadAvatarSprites(): void {
	for (const avatar of AVATARS) {
		loadSpriteImage(avatar.sprite.imageUrl).catch(() => {});
	}
}
