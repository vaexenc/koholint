import {and, eq, gte, lt} from "drizzle-orm";
import type {Db} from "./db";
import {evictPastCap} from "./db/evict";
import {resumeSlots} from "./db/schema";

export const RESUME_TTL_MS = 24 * 60 * 60 * 1000;
// hard ceiling on resume slots. bounds the table so connection churn —
// malicious or organic — can't grow it without limit before the 24h TTL sweeps
// it. the least-recently-touched rows are evicted once the cap is exceeded.
export const MAX_RESUME_SLOTS = 10_000;

// the slot is the row: the profile's fields sit flat alongside the pose, exactly
// as the table stores them. nesting a Profile here bought nothing — its one
// consumer destructures it immediately — and cost three hand-written field-by-
// field mappers, one of which silently dropped any column added later.
export type ResumeSlot = typeof resumeSlots.$inferSelect;

type SlotPatch = Partial<Omit<ResumeSlot, "resumeToken">>;

// the position half of a slot, named so the writers of it — the periodic
// checkpoint and the disconnect handler — share one shape.
export type SlotPose = Pick<ResumeSlot, "x" | "y" | "facing">;

// resume slots persisted in sqlite (_data/koholint.db). every method is a
// direct synchronous query; rows older than RESUME_TTL_MS are invisible to
// get() and deleted by the periodic sweep(). chat backlog and live state are
// not part of this table.
export class ResumeStore {
	private readonly db: Db;

	constructor(db: Db) {
		this.db = db;
	}

	get(token: string): ResumeSlot | undefined {
		return this.db
			.select()
			.from(resumeSlots)
			.where(
				and(
					eq(resumeSlots.resumeToken, token),
					gte(resumeSlots.lastSeenMs, Date.now() - RESUME_TTL_MS)
				)
			)
			.get();
	}

	upsert(slot: ResumeSlot): void {
		this.db
			.insert(resumeSlots)
			.values(slot)
			.onConflictDoUpdate({target: resumeSlots.resumeToken, set: slot})
			.run();
		evictPastCap(
			this.db,
			resumeSlots,
			resumeSlots.resumeToken,
			resumeSlots.lastSeenMs,
			MAX_RESUME_SLOTS
		);
	}

	touch(token: string, patch: SlotPatch): void {
		this.db
			.update(resumeSlots)
			.set({...patch, lastSeenMs: Date.now()})
			.where(eq(resumeSlots.resumeToken, token))
			.run();
	}

	// the plural of touch(), in one transaction. the periodic checkpoint updates
	// every live slot at once, and a bare loop would commit — and fsync — once
	// per player.
	touchMany(entries: ReadonlyArray<{readonly token: string; readonly patch: SlotPatch}>): void {
		if (entries.length === 0) return;
		this.db.transaction(() => {
			for (const {token, patch} of entries) this.touch(token, patch);
		});
	}

	sweep(): number {
		const result = this.db
			.delete(resumeSlots)
			.where(lt(resumeSlots.lastSeenMs, Date.now() - RESUME_TTL_MS))
			.run();
		return result.changes;
	}
}
