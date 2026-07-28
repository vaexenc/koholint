import {submitFeedback} from "@/client/api/feedback";
import {IconWidgetButton} from "@/client/components/hud/IconWidgetButton";
import {Button} from "@/client/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/client/components/ui/dialog";
import {Textarea} from "@/client/components/ui/textarea";
import {Tooltip, TooltipContent, TooltipTrigger} from "@/client/components/ui/tooltip";
import {FEEDBACK_MAX_LENGTH, validateFeedback} from "@/shared/protocol/feedback";
import {Bug, Check, Loader2, Send} from "lucide-react";
import {useState} from "react";

// speech-bubble button opening the feedback modal. the message is persisted
// server-side and read only from the admin panel, so nothing comes back to the
// player beyond the send confirmation.
export function FeedbackWidget({
	// display name sent along as context for whoever reads the feedback; the
	// server treats it as unverified.
	name,
	// lets the page react to the modal opening, e.g. to pause player movement.
	onOpenChange,
}: {
	name: string;
	onOpenChange?: (open: boolean) => void;
}) {
	const [open, setOpen] = useState(false);
	const [message, setMessage] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [sending, setSending] = useState(false);
	const [sent, setSent] = useState(false);

	// every open starts a fresh message — a dismissed draft is a discarded one.
	const handleOpenChange = (next: boolean) => {
		setOpen(next);
		onOpenChange?.(next);
		if (!next) return;
		setMessage("");
		setError(null);
		setSent(false);
	};

	const onSubmit = async () => {
		if (sending) return;
		const check = validateFeedback(message);
		if (!check.ok) {
			setError(check.reason);
			return;
		}
		setSending(true);
		const result = await submitFeedback(check.message, name);
		setSending(false);
		if (!result.ok) {
			setError(result.reason);
			return;
		}
		setSent(true);
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<Tooltip>
				<TooltipTrigger asChild>
					<DialogTrigger asChild>
						<IconWidgetButton label="feedback">
							<Bug />
						</IconWidgetButton>
					</DialogTrigger>
				</TooltipTrigger>
				{/* the widget hugs the top edge, so the tooltip hangs below it. */}
				<TooltipContent side="bottom">Feedback</TooltipContent>
			</Tooltip>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2 text-lg">
						<Bug className="h-5 w-5 shrink-0" />
						Feedback
					</DialogTitle>
					<DialogDescription>
						Found a bug, or have an idea? Tell us about it.
					</DialogDescription>
				</DialogHeader>
				{sent ? (
					<p className="flex items-center gap-2">
						<Check className="size-4 shrink-0 text-emerald-400" />
						Thanks for the feedback!
					</p>
				) : (
					<form
						className="flex flex-col gap-2"
						onSubmit={(e) => {
							e.preventDefault();
							void onSubmit();
						}}
					>
						<Textarea
							value={message}
							onChange={(e) => {
								setMessage(e.target.value);
								setError(null);
							}}
							maxLength={FEEDBACK_MAX_LENGTH}
							placeholder="your message"
							aria-invalid={error !== null}
							aria-label="feedback message"
							className="max-h-56 min-h-24"
						/>
						{error !== null && <p className="text-xs text-destructive">{error}</p>}
						<DialogFooter>
							<Button type="submit" disabled={sending || message.trim().length === 0}>
								{sending ? <Loader2 className="animate-spin" /> : <Send />}
								Send
							</Button>
						</DialogFooter>
					</form>
				)}
			</DialogContent>
		</Dialog>
	);
}
