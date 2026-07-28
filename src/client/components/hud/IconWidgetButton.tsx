import {HUD_PILL_ICON_PADDING, HUD_PILL_INTERACTIVE} from "@/client/components/hud/hudPill";
import {cn} from "@/client/lib/utils";
import type {ComponentProps} from "react";

// circular icon button in the widget material, styled like the connection
// pill. tooltip/popover trigger props arrive via asChild. a caller's className
// is merged on top of the widget material rather than replacing it — spreading
// props over it would drop the styling, spreading it under would drop the
// caller's.
export function IconWidgetButton({
	label,
	className,
	...props
}: {label: string} & ComponentProps<"button">) {
	return (
		<button
			type="button"
			aria-label={label}
			{...props}
			className={cn(HUD_PILL_INTERACTIVE, HUD_PILL_ICON_PADDING, "[&_svg]:size-4", className)}
		/>
	);
}
