import {useState, type Dispatch, type SetStateAction} from "react";

// the modal bookkeeping both map pages do.

export type ModalGroup = {
	profileOpen: boolean;
	setProfileOpen: Dispatch<SetStateAction<boolean>>;
	settingsOpen: boolean;
	setSettingsOpen: Dispatch<SetStateAction<boolean>>;
	feedbackOpen: boolean;
	setFeedbackOpen: Dispatch<SetStateAction<boolean>>;
	// any modal steals the keyboard: its keys (typing, focus nav, keybind
	// capture) shouldn't drive the character underneath. the editable-target
	// guard in KeyboardInputProvider already covers the chat box and name field.
	anyOpen: boolean;
};

export function useModalGroup(): ModalGroup {
	const [profileOpen, setProfileOpen] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [feedbackOpen, setFeedbackOpen] = useState(false);
	return {
		profileOpen,
		setProfileOpen,
		settingsOpen,
		setSettingsOpen,
		feedbackOpen,
		setFeedbackOpen,
		anyOpen: profileOpen || settingsOpen || feedbackOpen,
	};
}
