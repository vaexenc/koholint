import {
	drawChatBubbles,
	drawMovementHint,
	drawNameTag,
	drawTouchMovementHint,
	isMovementLearned,
	NAME_TAG_HEIGHT,
	pruneChatBubbles,
	pushChatBubble,
	type ChatBubble,
} from "@/client/game";
import {perfGauge} from "@/client/lib/perfHud";
import {hasCoarsePointer} from "@/client/lib/pointerType";
import type {SelfControls} from "@/client/session/selfControls";
import {interpolatedPose, type BasicCharacter} from "@/shared/game";
import type {ConnId} from "@/shared/protocol";

// everything drawn above the world in screen space: name tags, chat bubbles and
// the movement hint. it owns their state (the bubble stacks, the two visibility
// toggles, whether the player has learned to move) because nothing else reads
// it — keeping it here is what lets the game beneath be simulation and netcode
// only. the world is read through a live view rather than held, so entities can
// come and go without the overlays keeping any of them alive.

// a character that carries a name tag: the world entity plus the identity the
// tag renders.
export type LabelledCharacter = {
	readonly character: BasicCharacter;
	readonly name: string;
	readonly color: string;
};

export type OverlayWorld = {
	// every character that should carry a name tag, self included once it is in
	// the world.
	readonly labelled: () => Iterable<LabelledCharacter>;
	// whether a connId belongs to someone in this room at all — rostered, even
	// if their character isn't materialized right now. a bubble from a player
	// who is merely out of view is still worth keeping; one from a stranger
	// anchors to nothing.
	readonly knowsSpeaker: (connId: ConnId) => boolean;
	// the character a chat line should hang over, or null while that speaker has
	// no character in the world.
	readonly characterFor: (connId: ConnId) => BasicCharacter | null;
	// the local player, or null until the world has placed it.
	readonly self: () => BasicCharacter | null;
};

// what the movement hint reads to know it has done its job, and who to tell.
export type MovementHintDeps = {
	// the player's input channels as one handle: the hint retires on movement by
	// any of them, so it asks the set rather than each source in turn.
	readonly controls: SelfControls;
	readonly initiallyLearned: boolean;
	readonly onLearned: () => void;
};

export class WorldOverlays {
	private readonly world: OverlayWorld;
	private readonly hint: MovementHintDeps;
	private readonly bubbles = new Map<ConnId, ChatBubble[]>();
	private chatBubblesEnabled = true;
	private nameTagsEnabled = true;
	private movementLearned: boolean;
	// touch-primary devices get the hold-to-walk hint instead of the key hint.
	private readonly coarsePointer = hasCoarsePointer();

	constructor(world: OverlayWorld, hint: MovementHintDeps) {
		this.world = world;
		this.hint = hint;
		this.movementLearned = hint.initiallyLearned;
	}

	setChatBubblesEnabled(enabled: boolean): void {
		this.chatBubblesEnabled = enabled;
		if (!enabled) this.bubbles.clear();
	}

	setNameTagsEnabled(enabled: boolean): void {
		this.nameTagsEnabled = enabled;
	}

	pushChatBubble(senderId: ConnId, text: string): void {
		if (!this.chatBubblesEnabled) return;
		if (!this.world.knowsSpeaker(senderId)) return;
		let stack = this.bubbles.get(senderId);
		if (!stack) {
			stack = [];
			this.bubbles.set(senderId, stack);
		}
		pushChatBubble(stack, text, performance.now());
	}

	// a player who left takes their bubbles with them.
	dropSpeaker(senderId: ConnId): void {
		this.bubbles.delete(senderId);
	}

	// retires the hint for good. called when the player demonstrably knows how to
	// move — by moving, or by binding their own movement keys, since the hint
	// only ever teaches the defaults.
	retireMovementHint(): void {
		if (this.movementLearned) return;
		this.movementLearned = true;
		this.hint.onLearned();
	}

	draw(
		ctx: CanvasRenderingContext2D,
		alpha: number,
		worldToScreen: WorldToScreen,
		textScale: number
	): void {
		perfGauge("chat bubbles", this.bubbles.size);
		this.drawTags(ctx, alpha, worldToScreen, textScale);
		this.drawBubbles(ctx, alpha, worldToScreen, textScale);
		this.drawHint(ctx, alpha, worldToScreen);
	}

	private drawTags(
		ctx: CanvasRenderingContext2D,
		alpha: number,
		worldToScreen: WorldToScreen,
		textScale: number
	): void {
		if (!this.nameTagsEnabled) return;
		// a 20-char mono name tops out around 150px wide at scale 1; the tag
		// sits ~20px above the head.
		const cullX = 90 * textScale;
		const cullY = 40 * textScale;
		for (const {character, name, color} of this.world.labelled()) {
			if (!name) continue;
			const [screenX, screenY] = headScreenPos(character, alpha, worldToScreen);
			if (offScreen(screenX, screenY, cullX, cullY)) continue;
			drawNameTag(ctx, name, color, screenX, screenY, textScale);
		}
	}

	private drawBubbles(
		ctx: CanvasRenderingContext2D,
		alpha: number,
		worldToScreen: WorldToScreen,
		textScale: number
	): void {
		if (this.bubbles.size === 0) return;
		const now = performance.now();
		// generous cull margins: the widest bubble half plus the tallest stack
		// keep partially-visible bubbles drawn while skipping far-off characters.
		const cullX = 100 * textScale;
		const cullY = 220 * textScale;
		// bubbles anchor above the name tag when tags are shown.
		const raise = this.nameTagsEnabled ? NAME_TAG_HEIGHT * textScale : 0;
		for (const [connId, stack] of this.bubbles) {
			pruneChatBubbles(stack, now);
			if (stack.length === 0) {
				this.bubbles.delete(connId);
				continue;
			}
			const character = this.world.characterFor(connId);
			if (!character) continue;
			const [screenX, screenY] = headScreenPos(character, alpha, worldToScreen);
			if (offScreen(screenX, screenY, cullX, cullY)) continue;
			drawChatBubbles(ctx, stack, screenX, screenY - raise, now, textScale);
		}
	}

	private drawHint(
		ctx: CanvasRenderingContext2D,
		alpha: number,
		worldToScreen: WorldToScreen
	): void {
		const self = this.world.self();
		if (!self || this.movementLearned) return;
		const seen = this.hint.controls.seenKeys();
		// moving by any means retires the hint: a full key set, or a successful
		// hold-to-walk steer (touch, or click-to-move on desktop).
		if (this.hint.controls.hasSteered() || (!this.coarsePointer && isMovementLearned(seen))) {
			this.retireMovementHint();
			return;
		}
		// anchored at the feet, not the head, and without the hop lift: the hint
		// sits under the character it is teaching.
		const pose = interpolatedPose(self, alpha);
		const [screenX, screenY] = worldToScreen(
			pose.x + self.spriteWidth / 2,
			pose.y + self.spriteHeight
		);
		if (this.coarsePointer) drawTouchMovementHint(ctx, screenX, screenY, performance.now());
		else drawMovementHint(ctx, screenX, screenY, seen, performance.now());
	}
}

type WorldToScreen = (x: number, y: number) => readonly [number, number];

// screen position of the sprite-top center, jump offset applied — the shared
// anchor for above-head overlays, which ride the sprite rather than the ground.
function headScreenPos(
	char: BasicCharacter,
	alpha: number,
	worldToScreen: WorldToScreen
): readonly [number, number] {
	const pose = interpolatedPose(char, alpha);
	return worldToScreen(pose.x + char.spriteWidth / 2, pose.y - pose.jumpOffset);
}

// whether an above-head anchor is far enough outside the window that whatever
// hangs off it can't be visible. the margins are per-overlay, since a bubble
// stack reaches further above its anchor than a name tag does.
function offScreen(screenX: number, screenY: number, cullX: number, cullY: number): boolean {
	return (
		screenX < -cullX ||
		screenX > window.innerWidth + cullX ||
		screenY <= 0 ||
		screenY > window.innerHeight + cullY
	);
}
