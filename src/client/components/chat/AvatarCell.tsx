import {useAvatarIconUrl} from "@/client/components/avatar/avatarIcon";
import {memo} from "react";

// inline 16px avatar cell, shared by the chat rows and the player list. a fixed-
// size flex item so rows stay aligned regardless of per-sprite padding; the
// <img> draws from the shared per-appearance icon cache, so any number of rows
// cost one bitmap per look.
export const AvatarCell = memo(function AvatarCell({
	avatarId,
	paletteId,
}: {
	avatarId: string;
	paletteId: string | null;
}) {
	const iconUrl = useAvatarIconUrl(avatarId, paletteId);
	return (
		<span className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden">
			{iconUrl && (
				<img src={iconUrl} alt="" draggable={false} style={{imageRendering: "pixelated"}} />
			)}
		</span>
	);
});
