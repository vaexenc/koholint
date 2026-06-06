import {useEffect, useRef} from "react";

// mirrors `value` into a ref so callbacks captured once at mount (ws event
// handlers, init closures) can read the latest value without re-binding.
export function useLatestRef<T>(value: T) {
	const ref = useRef(value);
	useEffect(() => {
		ref.current = value;
	}, [value]);
	return ref;
}
