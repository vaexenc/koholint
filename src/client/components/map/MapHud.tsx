import {AdminBadge} from "@/client/components/hud/AdminBadge";
import {FeedbackWidget} from "@/client/components/hud/FeedbackWidget";
import {HudBar} from "@/client/components/hud/HudBar";
import {PositionWidget} from "@/client/components/hud/PositionWidget";
import {ProfileWidget} from "@/client/components/hud/ProfileWidget";
import {SettingsWidget} from "@/client/components/hud/SettingsWidget";
import type {MapSettings} from "@/client/components/map/useMapSettings";
import type {ModalGroup} from "@/client/components/map/useModalGroup";
import type {ReactNode} from "react";

type MapHudProps = {
	profileName: string;
	modals: ModalGroup;
	settings: MapSettings;
	playerTile: {x: number; y: number} | null;
	// mirrors both rows to the opposite corner, following the chat dock.
	reversed?: boolean;
	// the connection pill, when the route has one — the two modes report entirely
	// different things there, so the page supplies the whole widget.
	connection?: ReactNode;
	// extra checkboxes inside the settings popover, and inside the admin badge.
	// which toggle counts as an admin power differs per mode, so each page places
	// its own; a badge with nothing in it isn't rendered.
	settingsChildren?: ReactNode;
	adminChildren?: ReactNode;
};

// the widget cluster both map pages show: the feedback row up top and the
// pill/position/profile/settings row at the bottom. the pages differ only in the
// connection widget and in which toggles they hang off the two slots.
export function MapHud({
	profileName,
	modals,
	settings,
	playerTile,
	reversed = false,
	connection,
	settingsChildren,
	adminChildren,
}: MapHudProps) {
	return (
		<>
			<HudBar edge="top" reversed={reversed}>
				<FeedbackWidget name={profileName} onOpenChange={modals.setFeedbackOpen} />
			</HudBar>
			<HudBar reversed={reversed}>
				{connection}
				<PositionWidget playerTile={playerTile} />
				<ProfileWidget onOpenProfile={() => modals.setProfileOpen(true)} />
				<SettingsWidget
					bindings={settings.movementBindings}
					onBindingsChange={settings.setMovementBindings}
					clickToMove={settings.clickToMove}
					onClickToMoveChange={settings.setClickToMove}
					onOpenChange={modals.setSettingsOpen}
				>
					{settingsChildren}
				</SettingsWidget>
				{adminChildren && <AdminBadge>{adminChildren}</AdminBadge>}
			</HudBar>
		</>
	);
}
