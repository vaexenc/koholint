import {HUD_PILL_INTERACTIVE} from "@/components/hudPill";
import {cn} from "@/lib/utils";
import type {ComponentProps} from "react";

// circular icon button in the widget material, styled like the connection
// pill. tooltip/popover trigger props arrive via asChild.
export function IconWidgetButton({label, ...props}: {label: string} & ComponentProps<"button">) {
	return (
		<button
			type="button"
			aria-label={label}
			{...props}
			className={cn(HUD_PILL_INTERACTIVE, "p-2 pointer-coarse:p-2.5 [&_svg]:size-4")}
		/>
	);
}
