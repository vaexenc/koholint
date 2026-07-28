import {useLatestRef} from "@/client/lib/hooks/useLatestRef";
import {usePublished} from "@/client/lib/hooks/usePublished";
import {Camera, INITIAL_SCALE} from "@/client/viewport/camera";
import {clampScaleFor} from "@/client/viewport/cameraPolicy";
import {MapGestures} from "@/client/viewport/mapGestures";
import {
	loadMapAssets,
	MapHost,
	type MapHostOpts,
	type MapHostParams,
} from "@/client/viewport/mapHost";
import {
	useEffect,
	useRef,
	useState,
	type CSSProperties,
	type MouseEvent as ReactMouseEvent,
	type PointerEvent as ReactPointerEvent,
	type WheelEvent as ReactWheelEvent,
} from "react";

// the one map the game ships; both map pages default to it.
export const DEFAULT_MAP_URL = "/maps/overworld-map.json";

export type MapLoadState =
	| {status: "loading"}
	| {status: "ok"}
	| {status: "error"; message: string};

// which map, how to build its game, and every parameter the running host
// re-reads each frame. the live half is the host's own contract verbatim: the
// hook does nothing to it but mirror it into a ref, so restating the fields here
// would only be a second copy to keep in step.
export type UseMapRendererParams = MapHostParams & {
	readonly mapUrl: string;
	readonly init: MapHostOpts["init"];
};

export type UseMapRendererResult = {
	canvasProps: {
		ref: React.RefObject<HTMLCanvasElement | null>;
		className: string;
		style: CSSProperties;
		onPointerDown: (e: ReactPointerEvent<HTMLCanvasElement>) => void;
		onPointerMove: (e: ReactPointerEvent<HTMLCanvasElement>) => void;
		onPointerUp: (e: ReactPointerEvent<HTMLCanvasElement>) => void;
		onPointerCancel: (e: ReactPointerEvent<HTMLCanvasElement>) => void;
		onContextMenu: (e: ReactMouseEvent<HTMLCanvasElement>) => void;
		onWheel: (e: ReactWheelEvent<HTMLCanvasElement>) => void;
	};
	state: MapLoadState;
	playerTile: {x: number; y: number} | null;
};

// drives one map: loads its assets, runs a MapHost over them, and bridges the
// two things React needs out of it — the load state and the player tile the HUD
// reads. the camera math, the pointer gestures, the frame compositing and the
// render loop itself each live in their own module; nothing here draws.
export function useMapRenderer({
	mapUrl,
	init,
	...live
}: UseMapRendererParams): UseMapRendererResult {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const hostRef = useRef<MapHost | null>(null);

	// every live parameter, mirrored into one ref so the load effect (deps:
	// [mapUrl]) and the gesture handlers keep reading current values without
	// re-running the whole map load or re-binding.
	const params = useLatestRef<MapHostParams>(live);
	// `init` runs once per load rather than per frame, but it is a fresh closure
	// on every render, so the same mirror keeps it out of the load effect's deps
	// — a re-rendered page must not restart the map.
	const initRef = useLatestRef(init);

	const [state, setState] = useState<MapLoadState>({status: "loading"});
	const [isDragging, setIsDragging] = useState(false);
	// the host writes these every frame, so each publishes only on a change
	// the user could see: the player tile unless the whole tile changed, canDrag
	// on any flip. that keeps the HUD off the frame-rate re-render path.
	const [playerTile, publishPlayerTile] = usePublished<{x: number; y: number} | null>(
		null,
		(a, b) => a?.x === b?.x && a?.y === b?.y
	);
	const [canDrag, publishCanDrag] = usePublished(false);

	const cameraRef = useRef(new Camera(INITIAL_SCALE));
	const gesturesRef = useRef(new MapGestures());

	// wires the gesture handlers up once: every value they need is read through
	// a ref at gesture time, so this never has to be redone and the canvas never
	// has to re-bind them. before the host exists there is nothing to pan.
	useEffect(() => {
		gesturesRef.current.configure({
			camera: cameraRef.current,
			bounds: () => hostRef.current?.viewBounds() ?? null,
			clampScale: (scale) => clampScaleFor(params.current, scale),
			following: () => params.current.follow,
			clickToMove: () => params.current.clickToMove,
			steerTo: (point) => hostRef.current?.steerTo(point),
			onTileClick: (clientX, clientY) => hostRef.current?.handleTileClick(clientX, clientY),
			onDraggingChange: setIsDragging,
		});
	}, [params]);

	useEffect(() => {
		const gestures = gesturesRef.current;
		let cancelled = false;
		setState({status: "loading"});
		(async () => {
			try {
				const assets = await loadMapAssets(mapUrl);
				if (cancelled) return;
				const canvas = canvasRef.current;
				const ctx = canvas?.getContext("2d") ?? null;
				// no canvas to draw into: the assets still loaded, so the page
				// leaves the loading screen — there is simply no host to run.
				if (canvas && ctx) {
					const host = await MapHost.start({
						assets,
						canvas,
						ctx,
						camera: cameraRef.current,
						init: (initCtx) => initRef.current(initCtx),
						params,
						publish: {playerTile: publishPlayerTile, canDrag: publishCanDrag},
						cancelled: () => cancelled,
					});
					if (cancelled) {
						host?.dispose();
						return;
					}
					hostRef.current = host;
				}
				setState({status: "ok"});
			} catch (err) {
				if (!cancelled)
					setState({
						status: "error",
						message: err instanceof Error ? err.message : String(err),
					});
			}
		})();
		return () => {
			cancelled = true;
			hostRef.current?.dispose();
			hostRef.current = null;
			gestures.dispose();
		};
	}, [mapUrl, initRef, params, publishCanDrag, publishPlayerTile]);

	return {
		canvasProps: {
			ref: canvasRef,
			className: "absolute inset-0 h-full w-full touch-none select-none",
			style: {
				imageRendering: "pixelated",
				cursor: canDrag ? (isDragging ? "grabbing" : "grab") : "default",
			},
			onPointerDown: (e) => gesturesRef.current.onPointerDown(e),
			onPointerMove: (e) => gesturesRef.current.onPointerMove(e),
			onPointerUp: (e) => gesturesRef.current.onPointerUp(e),
			onPointerCancel: (e) => gesturesRef.current.onPointerUp(e),
			onContextMenu: (e) => gesturesRef.current.onContextMenu(e),
			onWheel: (e) => gesturesRef.current.onWheel(e),
		},
		state,
		playerTile,
	};
}
