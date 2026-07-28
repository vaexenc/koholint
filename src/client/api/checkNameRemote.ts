import {apiReason, postJson} from "@/client/api/http";
import {isRecord} from "@/shared/lib/isRecord";

export type RemoteNameResult = {ok: true} | {ok: false; reason: string};

// asks the server to validate a display name against the rules that can't ship
// to the client (the obscenity filter). called on demand at save time, never
// while typing. only an explicit rejection blocks the save: anything else — an
// unreachable server, a body we can't read — resolves ok and leaves the ws
// handshake as the authoritative backstop rather than trapping the player.
export async function checkNameRemote(name: string): Promise<RemoteNameResult> {
	const body = await postJson("/api/validate-name", {name});
	if (!isRecord(body) || body.ok !== false) return {ok: true};
	return {ok: false, reason: apiReason(body, "name is not allowed")};
}
