import {useCallback, useEffect, useRef} from "react";

// mirrors `value` into a ref so callbacks captured once at mount (ws event
// handlers, init closures) can read the latest value without re-binding.
export function useLatestRef<T>(value: T) {
	const ref = useRef(value);
	useEffect(() => {
		ref.current = value;
	}, [value]);
	return ref;
}

// the same live read, handed out as a stable function rather than a ref — for
// the consumers that live outside React entirely (the socket client, a running
// game) and already take a `() => T` as a dependency. none of them reads during
// render, and passing a function rather than a ref is what says so: a ref
// crossing that boundary can't be told apart from one read mid-render.
export function useLatestGetter<T>(value: T): () => T {
	const ref = useLatestRef(value);
	return useCallback(() => ref.current, [ref]);
}
