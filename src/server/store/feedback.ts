import type {FeedbackEntry, NewFeedbackEntry} from "@/shared/protocol/feedback";
import {desc, eq} from "drizzle-orm";
import type {Db} from "./db";
import {evictPastCap} from "./db/evict";
import {feedback} from "./db/schema";

// hard ceiling on stored feedback. the per-IP submit limit is the first line of
// defense; this only stops the table from growing without bound over the
// server's lifetime, shedding the oldest entries first.
export const MAX_FEEDBACK_ROWS = 10_000;

// player feedback persisted in sqlite, alongside the resume slots. write-only
// from the game client; the admin panel is the sole reader.
export class FeedbackStore {
	private readonly db: Db;

	constructor(db: Db) {
		this.db = db;
	}

	add(entry: NewFeedbackEntry): void {
		this.db.insert(feedback).values(entry).run();
		evictPastCap(this.db, feedback, feedback.id, feedback.createdAtMs, MAX_FEEDBACK_ROWS);
	}

	// read state is admin-only triage, so an id that no longer exists (evicted,
	// or a stale panel) is a no-op rather than an error.
	setRead(id: string, read: boolean): void {
		this.db.update(feedback).set({read}).where(eq(feedback.id, id)).run();
	}

	list(limit: number): FeedbackEntry[] {
		return this.db
			.select()
			.from(feedback)
			.orderBy(desc(feedback.createdAtMs))
			.limit(limit)
			.all();
	}
}
