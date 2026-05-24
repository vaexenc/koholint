export type EntityId = string;

export type Direction = "up" | "down" | "left" | "right";

export type CharacterInput = {
	readonly up: boolean;
	readonly down: boolean;
	readonly left: boolean;
	readonly right: boolean;
};

export const NEUTRAL_INPUT: CharacterInput = {up: false, down: false, left: false, right: false};

export function inputHasMovement(input: CharacterInput): boolean {
	return input.up || input.down || input.left || input.right;
}
