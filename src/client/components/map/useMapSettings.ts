import {storedBoolean, useLocalStorage} from "@/client/lib/hooks/useLocalStorage";
import {
	CLICK_TO_MOVE_KEY,
	MOVEMENT_BINDINGS_KEY,
	sanitizeMovementBindings,
} from "@/client/settings/movementBindings";
import {DEFAULT_KEY_BINDINGS, type KeyBindings} from "@/shared/game";
import type {Dispatch, SetStateAction} from "react";

// the settings both map pages persist. the offline and online pages differ in
// what they put in the HUD, not in this — keeping it here is what lets each page
// be little more than its own wiring.

export type MapSettings = {
	follow: boolean;
	setFollow: Dispatch<SetStateAction<boolean>>;
	debug: boolean;
	setDebug: Dispatch<SetStateAction<boolean>>;
	clickTeleport: boolean;
	setClickTeleport: Dispatch<SetStateAction<boolean>>;
	clickToMove: boolean;
	setClickToMove: Dispatch<SetStateAction<boolean>>;
	movementBindings: KeyBindings;
	setMovementBindings: Dispatch<SetStateAction<KeyBindings>>;
};

// `scope` namespaces the per-route toggles, so routes sharing a page (the root
// offline map, the standalone test map) persist them independently. movement
// preferences are user-level and stay on their own shared keys.
export function useMapSettings(scope: string): MapSettings {
	const [follow, setFollow] = useLocalStorage(`koholint:${scope}.follow`, true, storedBoolean);
	const [debug, setDebug] = useLocalStorage(`koholint:${scope}.debug`, false, storedBoolean);
	const [clickTeleport, setClickTeleport] = useLocalStorage(
		`koholint:${scope}.clickTeleport`,
		true,
		storedBoolean
	);
	const [clickToMove, setClickToMove] = useLocalStorage(CLICK_TO_MOVE_KEY, true, storedBoolean);
	const [movementBindings, setMovementBindings] = useLocalStorage<KeyBindings>(
		MOVEMENT_BINDINGS_KEY,
		DEFAULT_KEY_BINDINGS,
		sanitizeMovementBindings
	);
	return {
		follow,
		setFollow,
		debug,
		setDebug,
		clickTeleport,
		setClickTeleport,
		clickToMove,
		setClickToMove,
		movementBindings,
		setMovementBindings,
	};
}
