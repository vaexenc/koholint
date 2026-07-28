import {WindfishLoader} from "@/client/components/loading/WindfishLoader";
import {useEffect, useState} from "react";

// how long the screen must be up before anything inside it is drawn. loads that
// finish inside this window (a warm reload, a join that hands over to the
// offline map) stay a bare black cover: a flash of the loader reads worse than
// a blank background. the fade below softens the boundary, so a wait that only
// just crosses it doesn't pop either.
const SHOW_DELAY_MS = 400;

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
				<div className="flex animate-in flex-col items-center gap-3 fade-in-0 duration-300">
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
