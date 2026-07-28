import {TooltipProvider} from "@/client/components/ui/tooltip";
import {cn} from "@/client/lib/utils";
import type {ReactNode} from "react";

// a HUD row pinned to a viewport corner, and its tooltip scope. `reversed`
// mirrors it to the opposite corner (used when the chat swaps sides) so the
// leading widget keeps the outer edge; `edge` picks which of that side's two
// corners. the chat dock and its show-chat button own the corners on their own
// side, which leaves both of these free.
export function HudBar({
	edge = "bottom",
	reversed,
	children,
}: {
	edge?: "top" | "bottom";
	reversed?: boolean;
	children: ReactNode;
}) {
	return (
		<TooltipProvider>
			<div
				className={cn(
					"fixed z-10 flex max-w-[calc(100vw-1rem)] flex-wrap items-center gap-1 select-none",
					edge === "top"
						? "top-[max(0.5rem,env(safe-area-inset-top))]"
						: "bottom-[max(0.5rem,env(safe-area-inset-bottom))]",
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
