import type {Profile} from "@/shared/protocol";
import {NAME_MAX_LENGTH, validateName} from "@/shared/protocol/validateName";
import {AVATARS, type Avatar} from "@/shared/sprites/avatars";
import {PALETTES} from "@/shared/sprites/palettes";
import {adjectives, uniqueNamesGenerator} from "unique-names-generator";

const NAME_ATTEMPTS = 10;

function pick<T>(items: readonly T[]): T {
	return items[Math.floor(Math.random() * items.length)];
}

function threeDigits(): string {
	return Math.floor(Math.random() * 1000)
		.toString()
		.padStart(3, "0");
}

function capitalize(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}

// always a real palette — new players get a color, never the "off" swatch.
export function randomPaletteId(): string {
	return pick(PALETTES).id;
}

// Capitalized adjective + avatar name + 3-digit number, e.g. "BraveLink042".
// retries until the candidate clears validateName (mainly the length cap);
// falls back to a plain "playerNNN" if no adjective fits.
export function randomName(avatarName: string): string {
	// fold multi-word avatar names (e.g. "Prince Richard") into the compact
	// concatenated style, e.g. "BravePrinceRichard042".
	const compactName = avatarName.replace(/[^A-Za-z0-9]/g, "");
	for (let i = 0; i < NAME_ATTEMPTS; i++) {
		const adjective = uniqueNamesGenerator({
			dictionaries: [adjectives],
			length: 1,
			style: "lowerCase",
		});
		const candidate = `${capitalize(adjective)}${compactName}${threeDigits()}`;
		if (candidate.length <= NAME_MAX_LENGTH && validateName(candidate).ok) return candidate;
	}
	return `Player${threeDigits()}`;
}

export function randomProfile(): Profile {
	const avatar: Avatar = pick(AVATARS);
	return {
		name: randomName(avatar.shortName ?? avatar.name),
		avatarId: avatar.id,
		paletteId: randomPaletteId(),
	};
}
