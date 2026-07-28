// localStorage access that never throws — storage can be unavailable (private
// mode, blocked cookies) where the spec lets getItem/setItem raise.

export function getStored(key: string): string | null {
	try {
		return window.localStorage.getItem(key);
	} catch {
		return null;
	}
}

export function setStored(key: string, value: string): void {
	try {
		window.localStorage.setItem(key, value);
	} catch {
		// storage unavailable; skip silently.
	}
}
