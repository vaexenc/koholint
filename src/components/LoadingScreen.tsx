import {WindfishLoader} from "@/components/WindfishLoader";
import {useEffect, useState} from "react";

// don't show the loader for loads that finish almost immediately (e.g. a
// cached map when switching between the online and offline pages) — a
// sub-perceptible flash of it reads worse than a brief blank background.
const SHOW_DELAY_MS = 150;

// full-screen opaque loading overlay. sits above the canvas (which must stay
// mounted for the renderer's ref) and hides it until the world is ready.
export function LoadingScreen() {
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		const handle = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS);
		return () => window.clearTimeout(handle);
	}, []);

	if (!visible) return null;

	return (
		<div className="absolute inset-0 z-50 grid place-items-center bg-neutral-900 font-mono text-neutral-300">
			<div className="flex flex-col items-center gap-3">
				<WindfishLoader />
				<p className="text-sm">Loading</p>
			</div>
		</div>
	);
}
