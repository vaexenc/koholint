import {useCallback, useEffect, useRef, type RefObject} from "react";

export type GameMirror<T> = {
	// the live game for this map load; null before init has built one and after
	// the session disposes it.
	readonly ref: RefObject<T | null>;
	// adopts a freshly built game: brings it up to date with the page's current
	// options and makes it the live one.
	readonly attach: (game: T) => void;
	readonly detach: () => void;
	// the renderer's per-frame simulation step, bound through the ref, so a page
	// hands this straight to useMapRenderer instead of writing the same
	// ref-read-and-default around its own game. stable for the hook's lifetime;
	// returns 0 while no game is live, since a map still loading (or already
	// torn down) has nothing to advance.
	readonly step: (dtMs: number) => number;
};

// keeps a game in step with the page state it mirrors. `apply` runs on the game
// the moment it is attached — a map can finish loading with a modal already
// open, long after the effect last ran — and again whenever `apply` itself
// changes, which is whenever a value it reads does. pass a useCallback, so that
// holds. `ref` never changes identity, so handlers reading the live game through
// it don't churn when an option does.
export function useGameMirror<T extends {step: (dtMs: number) => number}>(
	apply: (game: T) => void
): GameMirror<T> {
	const ref = useRef<T | null>(null);
	useEffect(() => {
		const game = ref.current;
		if (game) apply(game);
	}, [apply]);
	const attach = useCallback(
		(game: T) => {
			apply(game);
			ref.current = game;
		},
		[apply]
	);
	const detach = useCallback(() => {
		ref.current = null;
	}, []);
	const step = useCallback((dtMs: number) => ref.current?.step(dtMs) ?? 0, []);
	return {ref, attach, detach, step};
}
