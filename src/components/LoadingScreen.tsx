// full-screen opaque loading overlay. sits above the canvas (which must stay
// mounted for the renderer's ref) and hides it until the world is ready.
export function LoadingScreen({label = "loading koholint…"}: {label?: string}) {
	return (
		<div className="absolute inset-0 z-50 grid place-items-center bg-neutral-900 font-mono text-neutral-300">
			<div className="flex flex-col items-center gap-3">
				<div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-600 border-t-neutral-200" />
				<p className="text-sm">{label}</p>
			</div>
		</div>
	);
}
