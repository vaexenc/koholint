import {useCallback, useRef, useState} from "react";

// state a render loop writes into React. the loop runs every frame but the
// overlay only wants a re-render when the value it shows actually changes, so
// the last published value is kept in a ref and setState is called only on a
// real change. `equal` lets a caller define "unchanged" for values React's
// Object.is would call distinct — a rounded zoom, a tile whose coordinates
// match.
//
// `publish` is stable for the hook's lifetime, so a loop started once at mount
// can hold onto it. `equal` is captured on the first render for the same
// reason; it is a pure comparison rather than a live parameter, so a caller
// passing a fresh arrow each render still gets the behavior it wrote.
export function usePublished<T>(
	initial: T,
	equal: (a: T, b: T) => boolean = Object.is
): [T, (next: T) => void] {
	const [value, setValue] = useState(initial);
	const publishedRef = useRef(initial);
	const equalRef = useRef(equal);
	const publish = useCallback((next: T) => {
		if (equalRef.current(publishedRef.current, next)) return;
		publishedRef.current = next;
		setValue(next);
	}, []);
	return [value, publish];
}
