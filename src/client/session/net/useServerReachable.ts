import {useLatestRef} from "@/client/lib/hooks/useLatestRef";
import {buildWsUrl, retryDelayMs} from "@/client/session/net/wsClient";
import {useEffect} from "react";

// an over-cap reject (server full, or too many connections from one address)
// still completes the handshake to deliver its reason and closes right after,
// so an open socket only counts as reachable once it has survived this long.
const SETTLE_MS = 500;

// polls the ws endpoint while `enabled` and calls `onReachable` once it accepts
// and holds a connection. the probe never sends a hello, so it claims no session
// and can't kick a tab that is still playing; it closes as soon as it has its
// answer and leaves the real join to WsClient.
export function useServerReachable(enabled: boolean, onReachable: () => void): void {
	const reachable = useLatestRef(onReachable);

	useEffect(() => {
		if (!enabled) return;
		let attempt = 0;
		let socket: WebSocket | null = null;
		let retryTimer: ReturnType<typeof setTimeout> | null = null;
		let settleTimer: ReturnType<typeof setTimeout> | null = null;

		const scheduleProbe = () => {
			retryTimer = setTimeout(openProbe, retryDelayMs(attempt));
			attempt++;
		};

		const openProbe = () => {
			retryTimer = null;
			const probe = new WebSocket(buildWsUrl());
			socket = probe;
			probe.addEventListener("open", () => {
				settleTimer = setTimeout(() => {
					settleTimer = null;
					// cleared first so the close below reads as ours, not as a
					// refusal worth retrying.
					socket = null;
					probe.close();
					reachable.current();
				}, SETTLE_MS);
			});
			probe.addEventListener("close", () => {
				if (socket !== probe) return;
				socket = null;
				if (settleTimer) clearTimeout(settleTimer);
				settleTimer = null;
				scheduleProbe();
			});
			// errors always precede a close; the retry is scheduled from there.
			probe.addEventListener("error", () => undefined);
		};

		// the caller reaches this right after a failed connect, so give the server
		// one backoff before asking again.
		scheduleProbe();
		return () => {
			if (retryTimer) clearTimeout(retryTimer);
			if (settleTimer) clearTimeout(settleTimer);
			socket?.close();
		};
	}, [enabled, reachable]);
}
