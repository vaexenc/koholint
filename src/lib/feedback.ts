export const FEEDBACK_MAX_LENGTH = 2000;

export type FeedbackEntry = {
	id: string;
	name: string | null;
	message: string;
	createdAtMs: number;
	// triaged in the admin panel; every entry starts unread.
	read: boolean;
};

export type NewFeedbackEntry = Omit<FeedbackEntry, "read">;

export type FeedbackValidation = {ok: true; message: string} | {ok: false; reason: string};

// shared by the feedback dialog (inline error before send) and the server
// (authoritative). the trimmed message is what gets stored, not the raw draft.
export function validateFeedback(raw: string): FeedbackValidation {
	const message = raw.trim();
	if (message.length === 0) return {ok: false, reason: "feedback is required"};
	if (message.length > FEEDBACK_MAX_LENGTH)
		return {ok: false, reason: `feedback must be at most ${FEEDBACK_MAX_LENGTH} characters`};
	return {ok: true, message};
}
