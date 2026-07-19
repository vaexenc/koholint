import type {Mode} from "@/components/ConnectionWidget";
import {useLocalStorage} from "@/lib/useLocalStorage";
import MapPage from "@/pages/MapPage";
import OnlineMapPage from "@/pages/OnlineMapPage";

// the single map route: online and offline are separate page components
// swapped in place, so a mode switch is a clean unmount/remount — the pose
// and profile continuity between them lives in lib/playerPose and the shared
// profile storage slot. the mode is persisted so a reload keeps you offline.
function RootMapPage() {
	const [storedMode, setMode] = useLocalStorage<Mode>("koholint:mode", "online");
	// the stored value is untyped json; anything unexpected falls back to online.
	const mode: Mode = storedMode === "offline" ? "offline" : "online";

	return mode === "offline" ? (
		<MapPage onModeChange={setMode} />
	) : (
		<OnlineMapPage onModeChange={setMode} />
	);
}

export default RootMapPage;
