import {apiReason, getJson, isApiOk, postJson} from "@/client/api/http";
import type {FeedbackEntry} from "@/shared/protocol/feedback";
import {isNumber, isRecord, parseAll} from "@/shared/protocol/guards";

export type SubmitFeedbackResult = {ok: true} | {ok: false; reason: string};

export type FeedbackListResult = {ok: true; entries: readonly FeedbackEntry[]} | {ok: false};

// the admin panel renders these straight into its list, so a row is rebuilt
// from validated fields only — the same treatment the ws frames get, since a
// proxy, a stale build or a mismatched schema can put anything on this wire.
function parseFeedbackEntry(value: unknown): FeedbackEntry | null {
	if (!isRecord(value)) return null;
	const {id, name, message, createdAtMs, read} = value;
	if (typeof id !== "string" || typeof message !== "string") return null;
	if (name !== null && typeof name !== "string") return null;
	if (!isNumber(createdAtMs) || typeof read !== "boolean") return null;
	return {id, name, message, createdAtMs, read};
}

// unlike the name pre-check, an unreachable server can't be waved through here:
// the message would be silently lost, so the failure is reported to the sender.
export async function submitFeedback(message: string, name: string): Promise<SubmitFeedbackResult> {
	const body = await postJson("/api/feedback", {message, name});
	if (isApiOk(body)) return {ok: true};
	if (body === null) return {ok: false, reason: "could not reach the server"};
	return {ok: false, reason: apiReason(body, "could not send feedback")};
}

// admin-only listing, authorized by the admin cookie the browser sends along.
// every failure collapses into a bare `ok: false` — a rejection carries nothing
// the panel could accidentally surface to whoever asked.
export async function fetchFeedback(): Promise<FeedbackListResult> {
	const body = await getJson("/api/admin/feedback");
	if (!isRecord(body)) return {ok: false};
	const entries = parseAll(body.entries, parseFeedbackEntry);
	return entries ? {ok: true, entries} : {ok: false};
}

// admin-only triage flag. the panel refetches on success, so the returned list
// — not the optimistic click — is what ends up on screen.
export async function setFeedbackRead(id: string, read: boolean): Promise<boolean> {
	return isApiOk(await postJson(`/api/admin/feedback/${encodeURIComponent(id)}/read`, {read}));
}
