import {HUD_PILL, HUD_PILL_INTERACTIVE} from "@/client/components/hud/hudPill";
import {Tooltip, TooltipContent, TooltipTrigger} from "@/client/components/ui/tooltip";
import {copyText} from "@/client/lib/clipboard";
import {hasCoarsePointer} from "@/client/lib/pointerType";
import {cn} from "@/client/lib/utils";
import {MapPin} from "lucide-react";
import {useState} from "react";

// tile coordinates read as fixed-width triples so the readout doesn't jitter as
// the player moves between one- and three-digit positions. negatives are left
// as-is rather than padded into a nonsense "0-5".
const pad3 = (n: number) => (n < 0 ? String(n) : String(n).padStart(3, "0"));

// position readout pill; click to copy the coordinates.
export function PositionWidget({playerTile}: {playerTile: {x: number; y: number} | null}) {
	// a nonce that increments per copy so the floating confirmation remounts and
	// replays its animation even on rapid repeat clicks; 0 means never copied.
	const [copyNonce, setCopyNonce] = useState(0);
	const coords = playerTile ? `${pad3(playerTile.x)}, ${pad3(playerTile.y)}` : null;
	const padClass = "gap-1 px-3 py-2 select-none pointer-coarse:py-2.5";

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				{coords ? (
					<button
						type="button"
						onClick={() => {
							void copyText(coords).then((ok) => {
								if (ok) setCopyNonce((n) => n + 1);
							});
						}}
						className={cn(HUD_PILL_INTERACTIVE, padClass, "relative")}
					>
						<MapPin className="size-3 text-neutral-400" />
						<span className="font-mono tabular-nums">{coords}</span>
						{copyNonce > 0 && (
							<span
								key={copyNonce}
								aria-hidden
								onAnimationEnd={() => setCopyNonce(0)}
								className="pointer-events-none absolute -top-4 left-1/2 animate-float-fade text-neutral-100 [text-shadow:0_1px_3px_rgb(0_0_0)]"
							>
								Copied!
							</span>
						)}
					</button>
				) : (
					<span className={cn(HUD_PILL, padClass)}>
						<MapPin className="size-3 text-neutral-400" />
						<span className="font-mono tabular-nums">—</span>
					</span>
				)}
			</TooltipTrigger>
			<TooltipContent side="top">
				{coords ? `Position (${hasCoarsePointer() ? "Tap" : "Click"} to copy)` : "Position"}
			</TooltipContent>
		</Tooltip>
	);
}
