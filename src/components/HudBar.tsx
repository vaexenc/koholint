import {TooltipProvider} from "@/components/ui/tooltip";
import {cn} from "@/lib/utils";
import type {ReactNode} from "react";

// the bottom HUD row and its tooltip scope. `reversed` mirrors it to the
// opposite corner (used when the chat swaps sides) so the leading widget keeps
// the outer edge.
export function HudBar({reversed, children}: {reversed?: boolean; children: ReactNode}) {
	return (
		<TooltipProvider>
			<div
				className={cn(
					"fixed bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-10 flex max-w-[calc(100vw-1rem)] flex-wrap items-center gap-1",
					reversed
						? "right-[max(0.5rem,env(safe-area-inset-right))] flex-row-reverse"
						: "left-[max(0.5rem,env(safe-area-inset-left))]"
				)}
			>
				{children}
			</div>
		</TooltipProvider>
	);
}
