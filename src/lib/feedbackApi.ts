import type {FeedbackEntry} from "@/lib/feedback";

export type SubmitFeedbackResult = {ok: true} | {ok: false; reason: string};

export type FeedbackListResult = {ok: true; entries: readonly FeedbackEntry[]} | {ok: false};

// unlike the name pre-check, an unreachable server can't be waved through here:
// the message would be silently lost, so the failure is reported to the sender.
export async function submitFeedback(
	message: string,
	name?: string
): Promise<SubmitFeedbackResult> {
	try {
		const res = await fetch("/api/feedback", {
			method: "POST",
			headers: {"content-type": "application/json"},
			body: JSON.stringify({message, name}),
		});
		const data: {ok?: boolean; reason?: string} = await res.json().catch(() => ({}));
		if (!res.ok || data.ok !== true)
			return {ok: false, reason: data.reason ?? "could not send feedback"};
		return {ok: true};
	} catch {
		return {ok: false, reason: "could not reach the server"};
	}
}

// admin-only listing, authorized by the admin cookie the browser sends along.
// every failure collapses into a bare `ok: false` — a rejection carries nothing
// the panel could accidentally surface to whoever asked.
export async function fetchFeedback(): Promise<FeedbackListResult> {
	try {
		const res = await fetch("/api/admin/feedback");
		const data: {entries?: FeedbackEntry[]} = await res.json().catch(() => ({}));
		if (!res.ok || !data.entries) return {ok: false};
		return {ok: true, entries: data.entries};
	} catch {
		return {ok: false};
	}
}

// admin-only triage flag. the panel refetches on success, so the returned list
// — not the optimistic click — is what ends up on screen.
export async function setFeedbackRead(id: string, read: boolean): Promise<boolean> {
	try {
		const res = await fetch(`/api/admin/feedback/${encodeURIComponent(id)}/read`, {
			method: "POST",
			headers: {"content-type": "application/json"},
			body: JSON.stringify({read}),
		});
		return res.ok;
	} catch {
		return false;
	}
}
