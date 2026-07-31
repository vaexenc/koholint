import {LoadingScreen} from "@/client/components/loading/LoadingScreen";
import {hasEnteredGame, markGameEntered} from "@/client/components/map/gameEntry";
import type {MapLoadState, UseMapRendererResult} from "@/client/viewport/useMapRenderer";
import {useEffect, type ReactNode} from "react";

type MapShellProps = {
	canvasProps: UseMapRendererResult["canvasProps"];
	state: MapLoadState;
	// whether the page still owes the player a loading screen. the shell shows
	// one only on a cold start: someone who has already been in the world this
	// session waits out a reload or a re-join on the map itself.
	loading: boolean;
	loadingMessage?: string;
	children: ReactNode;
};

// the frame every map page draws into: the full-viewport canvas, the map-load
// error overlay, and the loading gate in front of the HUD.
export function MapShell({canvasProps, state, loading, loadingMessage, children}: MapShellProps) {
	const failed = state.status === "error";
	useEffect(() => {
		if (!loading && !failed) markGameEntered();
	}, [loading, failed]);
	return (
		<div className="fixed inset-0 overflow-hidden bg-neutral-950">
			<canvas {...canvasProps} />
			{state.status === "error" ? (
				<div className="absolute inset-0 grid place-items-center p-4">
					<pre className="max-w-full whitespace-pre-wrap text-xs text-red-400">
						{state.message}
					</pre>
				</div>
			) : loading && !hasEnteredGame() ? (
				<LoadingScreen message={loadingMessage} />
			) : (
				children
			)}
		</div>
	);
}
