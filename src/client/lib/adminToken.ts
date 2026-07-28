import {getStored} from "@/client/lib/safeStorage";

const ADMIN_TOKEN_KEY = "koholint:admin";

export function readAdminToken(): string | undefined {
	return getStored(ADMIN_TOKEN_KEY) || undefined;
}

// offline can't verify with the server, so a stored token is the only signal;
// the badge is cosmetic here and grants no powers the server didn't hand out.
export function hasAdminToken(): boolean {
	return readAdminToken() !== undefined;
}
