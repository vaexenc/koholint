import {storedOneOf, useLocalStorage} from "@/client/lib/hooks/useLocalStorage";
import MapPage from "@/client/pages/MapPage";
import OnlineMapPage from "@/client/pages/OnlineMapPage";
import type {Mode} from "@/client/session/mode";
import {useServerReachable} from "@/client/session/net/useServerReachable";
import type {ConnectionError} from "@/client/session/net/wsClient";
import {useCallback, useState} from "react";

const MODE_STORAGE = storedOneOf<Mode>(["online", "offline"]);

// the single map route: online and offline are separate page components
// swapped in place, so a mode switch is a clean unmount/remount — the pose
// and profile continuity between them lives in lib/playerPose and the shared
// profile storage slot. the mode is persisted so a reload keeps you offline.
function RootMapPage() {
	const [mode, setMode] = useLocalStorage<Mode>("koholint:mode", "online", MODE_STORAGE);
	// a join that fails puts the player on the offline map rather than a loading
	// screen they can't leave. that was the server's doing, not the player's
	// choice, so it stays out of the stored mode and lasts only as long as the
	// server stays unreachable. the value is why it failed, for the pill's hover.
	const [dropped, setDropped] = useState<ConnectionError | null>(null);
	const reconnecting = mode === "online" && dropped !== null;
	const onServerBack = useCallback(() => setDropped(null), []);
	// the reason stays the frozen one from the failed join, but its retry
	// countdown follows the probe — the schedule the join died with is long gone.
	const onProbeScheduled = useCallback(
		(nextAttemptAt: number) =>
			setDropped((prev) => (prev === null ? prev : {...prev, nextAttemptAt})),
		[]
	);
	useServerReachable(reconnecting, onServerBack, onProbeScheduled);

	// an explicit pick settles the fallback either way: offline stops the probing,
	// online retries the join right now.
	const selectMode = useCallback(
		(next: Mode) => {
			setDropped(null);
			setMode(next);
		},
		[setMode]
	);
	const onJoinFailed = useCallback((error: ConnectionError) => setDropped(error), []);

	return mode === "offline" || reconnecting ? (
		<MapPage onModeChange={selectMode} reconnecting={reconnecting} connectionError={dropped} />
	) : (
		<OnlineMapPage onModeChange={selectMode} onJoinFailed={onJoinFailed} />
	);
}

export default RootMapPage;
