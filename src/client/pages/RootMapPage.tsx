import {storedOneOf, useLocalStorage} from "@/client/lib/hooks/useLocalStorage";
import MapPage from "@/client/pages/MapPage";
import OnlineMapPage from "@/client/pages/OnlineMapPage";
import type {Mode} from "@/client/session/mode";
import {useServerReachable} from "@/client/session/net/useServerReachable";
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
	// server stays unreachable.
	const [dropped, setDropped] = useState(false);
	const reconnecting = mode === "online" && dropped;
	const onServerBack = useCallback(() => setDropped(false), []);
	useServerReachable(reconnecting, onServerBack);

	// an explicit pick settles the fallback either way: offline stops the probing,
	// online retries the join right now.
	const selectMode = useCallback(
		(next: Mode) => {
			setDropped(false);
			setMode(next);
		},
		[setMode]
	);
	const onJoinFailed = useCallback(() => setDropped(true), []);

	return mode === "offline" || reconnecting ? (
		<MapPage onModeChange={selectMode} reconnecting={reconnecting} />
	) : (
		<OnlineMapPage onModeChange={selectMode} onJoinFailed={onJoinFailed} />
	);
}

export default RootMapPage;
