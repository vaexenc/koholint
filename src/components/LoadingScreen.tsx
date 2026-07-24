import {WindfishLoader} from "@/components/WindfishLoader";
import {useEffect, useState} from "react";

// don't show the loader for loads that finish almost immediately (e.g. a
// cached map when switching between the online and offline pages) — a
// sub-perceptible flash of it reads worse than a brief blank background.
const SHOW_DELAY_MS = 150;

// full-screen opaque loading overlay. sits above the canvas (which must stay
// mounted for the renderer's ref) and hides it until the world is ready. the
// opaque cover renders from the first frame — only the loader graphic waits
// out SHOW_DELAY_MS, else a stale canvas frame peeks through during the delay.
type LoadingScreenProps = {
	// connection trouble surfaced under the headline, e.g. "server is full".
	message?: string;
};

export function LoadingScreen({message}: LoadingScreenProps) {
	const [showLoader, setShowLoader] = useState(false);

	useEffect(() => {
		const handle = window.setTimeout(() => setShowLoader(true), SHOW_DELAY_MS);
		return () => window.clearTimeout(handle);
	}, []);

	return (
		<div className="absolute inset-0 z-50 grid place-items-center bg-neutral-950 font-zelda text-neutral-300">
			{showLoader && (
				<div className="flex flex-col items-center gap-3">
					<WindfishLoader />
					<p className="text-2xl -tracking-widest">Loading</p>
					{/* always rendered at one line-height so a message appearing
					    doesn't shift the loader above */}
					<p className="min-h-7 text-lg text-neutral-400">{message}</p>
				</div>
			)}
		</div>
	);
}
