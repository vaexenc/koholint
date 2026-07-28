import {isRecord} from "@/shared/lib/isRecord";

// the chat preference model: what the modes are, what they default to, how an
// untrusted stored value becomes one, and how the two settings that change what
// text is shown resolve it. all policy, no rendering — the panel reads these,
// and so does the page that puts chat lines into the world as bubbles, without
// either having to import the other.

// every preference is a named mode picked from a fixed list, so the list is the
// whole declaration: the settings type, the storage sanitizer and the settings
// popover all derive from this one table.
export const CHAT_SETTING_MODES = {
	timestampMode: ["off", "24h", "12h"],
	avatarMode: ["off", "on"],
	// presence join/leave/reconnect lines are off by default; users opt in from
	// the chat settings popover.
	presenceMode: ["off", "on"],
	// "on" reveals the unfiltered text the server ships alongside the censored
	// version; off (default) keeps obscenities masked.
	obscenityMode: ["off", "on"],
} as const;

export type ChatSettings = {
	readonly [K in keyof typeof CHAT_SETTING_MODES]: (typeof CHAT_SETTING_MODES)[K][number];
};

export type ChatSettingKey = keyof ChatSettings;

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
	timestampMode: "24h",
	avatarMode: "on",
	presenceMode: "off",
	obscenityMode: "off",
};

// the rows the settings popover renders, in order.
export const CHAT_SETTING_ROWS: ReadonlyArray<{key: ChatSettingKey; label: string}> = [
	{key: "timestampMode", label: "timestamps"},
	{key: "avatarMode", label: "avatars"},
	{key: "presenceMode", label: "presence"},
	{key: "obscenityMode", label: "obscenities"},
];

function pickMode<T extends string>(values: readonly T[], raw: unknown, fallback: T): T {
	return values.find((mode) => mode === raw) ?? fallback;
}

// the trust boundary for chat preferences, whether they came out of storage or
// off a toggle in the popover: each mode falls back on its own default, so one
// unrecognized value can't void the rest. being the only validator is what lets
// the popover work in plain strings and keep no type guards of its own.
//
// spelled out per key rather than looped: ChatSettings is a mapped type over
// CHAT_SETTING_MODES, so a mode added to the table makes this object literal
// fail to compile until it is handled here too.
export function sanitizeChatSettings(raw: unknown): ChatSettings {
	const source = isRecord(raw) ? raw : {};
	const modes = CHAT_SETTING_MODES;
	const defaults = DEFAULT_CHAT_SETTINGS;
	return {
		timestampMode: pickMode(modes.timestampMode, source.timestampMode, defaults.timestampMode),
		avatarMode: pickMode(modes.avatarMode, source.avatarMode, defaults.avatarMode),
		presenceMode: pickMode(modes.presenceMode, source.presenceMode, defaults.presenceMode),
		obscenityMode: pickMode(modes.obscenityMode, source.obscenityMode, defaults.obscenityMode),
	};
}

// resolves which variant of a chat message's text to display: "on" reveals the
// unfiltered original when the server shipped one. shared by the message list
// and the in-world chat bubbles so both surfaces agree.
export function chatDisplayText(
	m: {readonly text: string; readonly rawText?: string},
	obscenityMode: ChatSettings["obscenityMode"]
): string {
	return obscenityMode === "on" && m.rawText !== undefined ? m.rawText : m.text;
}

export function formatChatTime(ts: number, mode: ChatSettings["timestampMode"]): string {
	if (mode === "off") return "";
	const d = new Date(ts);
	const mm = d.getMinutes().toString().padStart(2, "0");
	if (mode === "24h") return `${d.getHours().toString().padStart(2, "0")}:${mm}`;
	const h12 = ((d.getHours() + 11) % 12) + 1;
	return `${h12}:${mm} ${d.getHours() < 12 ? "AM" : "PM"}`;
}
