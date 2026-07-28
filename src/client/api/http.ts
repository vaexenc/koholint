import {isRecord} from "@/shared/lib/isRecord";

// the client half of the HTTP api. one json round-trip, handed back as
// `unknown` so every caller runs the body through its own guard — the same rule
// the ws boundary follows, where a response is untrusted until something has
// checked its shape.
//
// null means "no usable answer": the request failed, or the body wasn't json.
// the api encodes every outcome it wants a caller to distinguish inside the
// body (`ok`, `entries`), so the status code carries nothing extra and callers
// need only tell null apart from a body — which is unambiguous, since the api
// never answers with a bare json null.

async function requestJson(url: string, init?: RequestInit): Promise<unknown> {
	try {
		const response = await fetch(url, init);
		return await response.json();
	} catch {
		return null;
	}
}

export function getJson(url: string): Promise<unknown> {
	return requestJson(url);
}

export function postJson(url: string, body: unknown): Promise<unknown> {
	return requestJson(url, {
		method: "POST",
		headers: {"content-type": "application/json"},
		body: JSON.stringify(body),
	});
}

// whether the api answered with its success shape. the failure side carries a
// reason, which callers that show one read with `apiReason`.
export function isApiOk(body: unknown): boolean {
	return isRecord(body) && body.ok === true;
}

export function apiReason(body: unknown, fallback: string): string {
	return isRecord(body) && typeof body.reason === "string" ? body.reason : fallback;
}
