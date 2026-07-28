import {fetchFeedback, setFeedbackRead} from "@/client/api/feedback";
import {Button} from "@/client/components/ui/button";
import {Toggle} from "@/client/components/ui/toggle";
import {cn} from "@/client/lib/utils";
import {NotFound} from "@/client/pages/NotFound";
import type {FeedbackEntry} from "@/shared/protocol/feedback";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {Check, Eye, EyeOff, RefreshCw, Undo2} from "lucide-react";
import {useState} from "react";

const FEEDBACK_QUERY_KEY = ["adminFeedback"];

// admin-only view of the feedback players submitted from the map HUD. the
// server is the only authority: nothing renders until it has answered with the
// list, so an unauthorized visitor sees no panel, no chrome and no hint that
// either exists. how to obtain the cookie is documented in .env.example, not
// here. loaded as its own chunk (see App), so the markup isn't in the bundle
// every player downloads.
function AdminPage() {
	const queryClient = useQueryClient();
	const [unreadOnly, setUnreadOnly] = useState(false);
	const {data, isFetching, refetch} = useQuery({
		queryKey: FEEDBACK_QUERY_KEY,
		queryFn: fetchFeedback,
	});
	// read state lives server-side, so the refetch — not the click — is what
	// settles what the panel shows.
	const {mutate: markRead} = useMutation({
		mutationFn: ({id, read}: {id: string; read: boolean}) => setFeedbackRead(id, read),
		onSuccess: () => queryClient.invalidateQueries({queryKey: FEEDBACK_QUERY_KEY}),
	});

	if (!data) return null;
	// unauthorized and unreachable are deliberately indistinguishable.
	if (!data.ok) return <NotFound />;

	const unread = data.entries.filter((entry) => !entry.read).length;
	const visible = unreadOnly ? data.entries.filter((entry) => !entry.read) : data.entries;

	return (
		<div className="min-h-dvh bg-neutral-950 font-mono text-neutral-100">
			<div className="mx-auto flex max-w-3xl flex-col gap-4 p-4 sm:p-6">
				<header className="flex items-center justify-between gap-2">
					<h1 className="text-lg font-medium">
						Feedback
						<span className="ml-2 text-sm text-muted-foreground">
							{unread} / {data.entries.length}
						</span>
					</h1>
					<div className="flex items-center gap-2">
						<Toggle
							variant="outline"
							size="sm"
							pressed={unreadOnly}
							onPressedChange={setUnreadOnly}
						>
							{unreadOnly ? <EyeOff /> : <Eye />}
							Unread only
						</Toggle>
						<Button
							variant="outline"
							size="sm"
							onClick={() => void refetch()}
							disabled={isFetching}
						>
							<RefreshCw className={isFetching ? "animate-spin" : undefined} />
							Refresh
						</Button>
					</div>
				</header>
				{visible.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						{data.entries.length === 0 ? "no feedback yet." : "nothing unread."}
					</p>
				) : (
					<ul className="flex flex-col gap-2">
						{visible.map((entry) => (
							<EntryCard
								key={entry.id}
								entry={entry}
								onToggleRead={() => markRead({id: entry.id, read: !entry.read})}
							/>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}

function EntryCard({entry, onToggleRead}: {entry: FeedbackEntry; onToggleRead: () => void}) {
	const sentAt = new Date(entry.createdAtMs);
	return (
		<li
			className={cn(
				"flex flex-col gap-1.5 rounded-xl bg-black/30 p-3 ring-1 ring-white/10",
				entry.read && "opacity-60"
			)}
		>
			<div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
				{/* the name is whatever the client claimed at submit time, so it
				    identifies loosely at best. */}
				<span className="truncate">{entry.name ?? "anonymous"}</span>
				<time dateTime={sentAt.toISOString()} className="shrink-0">
					{sentAt.toLocaleString()}
				</time>
			</div>
			<p className="text-sm wrap-break-word whitespace-pre-wrap">{entry.message}</p>
			<Button
				variant="ghost"
				size="xs"
				onClick={onToggleRead}
				className="self-end text-muted-foreground"
			>
				{entry.read ? <Undo2 /> : <Check />}
				{entry.read ? "unread" : "read"}
			</Button>
		</li>
	);
}

export default AdminPage;
