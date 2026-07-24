import type {Direction} from "@/game/types";
import type {Profile} from "@/protocol";
import {and, eq, gte, lt} from "drizzle-orm";
import type {Db} from "./db";
import {evictPastCap} from "./db/evict";
import {resumeSlots} from "./db/schema";

export const RESUME_TTL_MS = 24 * 60 * 60 * 1000;
// hard ceiling on resume slots. bounds the table so connection churn —
// malicious or organic — can't grow it without limit before the 24h TTL sweeps
// it. the least-recently-touched rows are evicted once the cap is exceeded.
export const MAX_RESUME_SLOTS = 10_000;

export type ResumeSlot = {
	resumeToken: string;
	connId: string;
	idIndex: number;
	profile: Profile;
	x: number;
	y: number;
	facing: Direction;
	lastSeenMs: number;
};

type SlotPatch = Partial<Omit<ResumeSlot, "resumeToken">>;
type SlotRow = typeof resumeSlots.$inferSelect;

// resume slots persisted in sqlite (server/data/koholint.db). every method is a
// direct synchronous query; rows older than RESUME_TTL_MS are invisible to
// get() and deleted by the periodic sweep(). chat backlog and live state are
// not part of this table.
export class ResumeStore {
	private readonly db: Db;

	constructor(db: Db) {
		this.db = db;
	}

	get(token: string): ResumeSlot | undefined {
		const row = this.db
			.select()
			.from(resumeSlots)
			.where(
				and(
					eq(resumeSlots.resumeToken, token),
					gte(resumeSlots.lastSeenMs, Date.now() - RESUME_TTL_MS)
				)
			)
			.get();
		return row === undefined ? undefined : rowToSlot(row);
	}

	upsert(slot: ResumeSlot): void {
		const row = slotToRow(slot);
		this.db
			.insert(resumeSlots)
			.values(row)
			.onConflictDoUpdate({target: resumeSlots.resumeToken, set: row})
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
			.set({...flattenPatch(patch), lastSeenMs: Date.now()})
			.where(eq(resumeSlots.resumeToken, token))
			.run();
	}

	sweep(): number {
		const result = this.db
			.delete(resumeSlots)
			.where(lt(resumeSlots.lastSeenMs, Date.now() - RESUME_TTL_MS))
			.run();
		return result.changes;
	}
}

function rowToSlot(row: SlotRow): ResumeSlot {
	return {
		resumeToken: row.resumeToken,
		connId: row.connId,
		idIndex: row.idIndex,
		profile: {name: row.name, avatarId: row.avatarId, paletteId: row.paletteId},
		x: row.x,
		y: row.y,
		facing: row.facing,
		lastSeenMs: row.lastSeenMs,
	};
}

function slotToRow(slot: ResumeSlot): SlotRow {
	return {
		resumeToken: slot.resumeToken,
		connId: slot.connId,
		idIndex: slot.idIndex,
		name: slot.profile.name,
		avatarId: slot.profile.avatarId,
		paletteId: slot.profile.paletteId,
		x: slot.x,
		y: slot.y,
		facing: slot.facing,
		lastSeenMs: slot.lastSeenMs,
	};
}

function flattenPatch(patch: SlotPatch): Partial<SlotRow> {
	const flat: Partial<SlotRow> = {};
	if (patch.connId !== undefined) flat.connId = patch.connId;
	if (patch.idIndex !== undefined) flat.idIndex = patch.idIndex;
	if (patch.profile !== undefined) {
		flat.name = patch.profile.name;
		flat.avatarId = patch.profile.avatarId;
		flat.paletteId = patch.profile.paletteId;
	}
	if (patch.x !== undefined) flat.x = patch.x;
	if (patch.y !== undefined) flat.y = patch.y;
	if (patch.facing !== undefined) flat.facing = patch.facing;
	if (patch.lastSeenMs !== undefined) flat.lastSeenMs = patch.lastSeenMs;
	return flat;
}
