export type RemoteNameResult = {ok: true} | {ok: false; reason: string};

// asks the server to validate a display name against the rules that can't ship
// to the client (the obscenity filter). called on demand at save time, never
// while typing. if the server is unreachable we resolve ok and let the ws
// handshake stay authoritative as the backstop, rather than blocking save.
export async function checkNameRemote(name: string): Promise<RemoteNameResult> {
	try {
		const res = await fetch("/api/validate-name", {
			method: "POST",
			headers: {"content-type": "application/json"},
			body: JSON.stringify({name}),
		});
		const data: {ok?: boolean; reason?: string} = await res.json();
		if (data.ok === false)
			return {ok: false, reason: data.reason ?? "name is not allowed"};
		return {ok: true};
	} catch {
		return {ok: true};
	}
}
