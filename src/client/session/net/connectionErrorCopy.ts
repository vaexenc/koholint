import type {ConnectionError} from "@/client/session/net/wsClient";

// fallback copy when the server didn't say why in a connectionRejected frame
// (e.g. it's unreachable). ascii-only: the zelda pixel font has no
// ellipsis/em-dash glyphs.
const CONNECTION_ERROR_COPY: Record<ConnectionError["kind"], string> = {
	serverFull: "Server is full",
	sessionTaken: "Session was opened somewhere else",
	rejected: "Server rejected the connection",
	unreachable: "Can't reach server",
};

// why the connection isn't up, in one line — for the loading screen and for the
// connection pill's hover. server-authored copy wins over our guess at the kind.
export function connectionErrorText(error: ConnectionError): string {
	return error.message ?? CONNECTION_ERROR_COPY[error.kind];
}
