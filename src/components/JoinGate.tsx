import {AvatarPicker} from "@/components/avatar-picker/AvatarPicker";
import {Button} from "@/components/ui/button";
import {validateName} from "@/lib/validateName";

type JoinGateProps = {
	name: string;
	onNameChange: (next: string) => void;
	serverNameError?: string;
	avatarId: string;
	paletteId: string | null;
	onChange: (avatarId: string, paletteId: string | null) => void;
	onJoin: () => void;
	// true once the player pressed Join and we're connecting / awaiting welcome.
	joining: boolean;
};

// the first-run gate: a full-screen overlay that blocks the world until the
// player picks a valid name and presses Join. plain overlay rather than a
// dialog so there's nothing to suppress — there is no dismiss path.
export function JoinGate({
	name,
	onNameChange,
	serverNameError,
	avatarId,
	paletteId,
	onChange,
	onJoin,
	joining,
}: JoinGateProps) {
	const canJoin = validateName(name).ok && !joining;
	return (
		<div className="absolute inset-0 z-50 grid place-items-center bg-neutral-900/80 p-4 backdrop-blur">
			<form
				className="grid w-full max-w-2xl gap-6 rounded-lg border border-border bg-background p-6 shadow-lg"
				onSubmit={(e) => {
					e.preventDefault();
					if (canJoin) onJoin();
				}}
			>
				<h2 className="text-lg font-semibold">Welcome to Koholint</h2>
				<AvatarPicker
					avatarId={avatarId}
					paletteId={paletteId}
					onChange={onChange}
					name={name}
					onNameChange={onNameChange}
					serverNameError={serverNameError}
					active
				/>
				<Button type="submit" className="h-12 w-full text-base" disabled={!canJoin}>
					{joining ? "Joining…" : "Join"}
				</Button>
			</form>
		</div>
	);
}
