import {IconWidgetButton} from "@/components/IconWidgetButton";
import {Tooltip, TooltipContent, TooltipTrigger} from "@/components/ui/tooltip";
import {UserRound} from "lucide-react";

// opens the profile modal.
export function ProfileWidget({onOpenProfile}: {onOpenProfile: () => void}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<IconWidgetButton label="profile" onClick={onOpenProfile}>
					<UserRound />
				</IconWidgetButton>
			</TooltipTrigger>
			<TooltipContent side="top">Profile</TooltipContent>
		</Tooltip>
	);
}
