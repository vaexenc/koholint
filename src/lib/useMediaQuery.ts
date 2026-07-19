import {COARSE_POINTER_QUERY} from "@/lib/pointerType";
import {useCallback, useSyncExternalStore} from "react";

export function useMediaQuery(query: string): boolean {
	const subscribe = useCallback(
		(onChange: () => void) => {
			const mql = window.matchMedia(query);
			mql.addEventListener("change", onChange);
			return () => mql.removeEventListener("change", onChange);
		},
		[query]
	);
	return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}

// below tailwind's `sm` breakpoint (40rem) — where the chat panel switches
// from a side dock to a full-screen overlay and the map stops insetting.
// keep in sync with the `sm:` classes on those components.
export function useIsSmallScreen(): boolean {
	return !useMediaQuery("(min-width: 40rem)");
}

export function useHasCoarsePointer(): boolean {
	return useMediaQuery(COARSE_POINTER_QUERY);
}
