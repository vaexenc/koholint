import type {Direction} from "@/game/types";
import type {Profile} from "@/protocol";
import {mkdir, readFile, rename, writeFile} from "node:fs/promises";
import path from "node:path";
import {log} from "./log";

export const RESUME_TTL_MS = 24 * 60 * 60 * 1000;
// hard ceiling on resume slots. bounds memory and the size of resume.json
// (rewritten wholesale on every persist) so connection churn — malicious or
// organic — can't grow the table without limit before the 24h TTL sweeps it.
// the least-recently-touched slot is evicted once the cap is reached.
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

type Persisted = {
	readonly version: 1;
	readonly slots: ReadonlyArray<ResumeSlot>;
};

// in-memory index of resume slots, indexed by token. persisted to a single
// json file on graceful shutdown + every 60s while running. on boot, slots
// older than RESUME_TTL_MS are discarded. lost on file corruption — chat
// backlog and live state are not part of this table.
export class ResumeStore {
	private byToken = new Map<string, ResumeSlot>();
	private filePath: string;

	constructor(dataDir: string) {
		this.filePath = path.join(dataDir, "resume.json");
	}

	async load(): Promise<void> {
		try {
			const raw = await readFile(this.filePath, "utf-8");
			const parsed: Persisted = JSON.parse(raw);
			if (parsed.version !== 1) return;
			const now = Date.now();
			for (const slot of parsed.slots) {
				if (now - slot.lastSeenMs > RESUME_TTL_MS) continue;
				this.byToken.set(slot.resumeToken, slot);
			}
			log.info(`resume: loaded ${this.byToken.size} slot(s) from ${this.filePath}`);
		} catch (err) {
			if (isMissingFile(err)) {
				log.info(`resume: no prior file at ${this.filePath}, starting fresh`);
				return;
			}
			log.warn(`resume: failed to load ${this.filePath}:`, err);
		}
	}

	async persist(): Promise<void> {
		const now = Date.now();
		const slots: ResumeSlot[] = [];
		for (const slot of this.byToken.values()) {
			if (now - slot.lastSeenMs > RESUME_TTL_MS) continue;
			slots.push(slot);
		}
		const payload: Persisted = {version: 1, slots};
		const tmp = `${this.filePath}.tmp`;
		await mkdir(path.dirname(this.filePath), {recursive: true});
		await writeFile(tmp, JSON.stringify(payload), "utf-8");
		await rename(tmp, this.filePath);
	}

	sweep(): number {
		const now = Date.now();
		let removed = 0;
		for (const [token, slot] of this.byToken) {
			if (now - slot.lastSeenMs > RESUME_TTL_MS) {
				this.byToken.delete(token);
				removed++;
			}
		}
		return removed;
	}

	get(token: string): ResumeSlot | undefined {
		return this.byToken.get(token);
	}

	upsert(slot: ResumeSlot): void {
		// re-key so the entry moves to the most-recent end of the Map's iteration
		// order; eviction then sheds the least-recently-touched slot in O(1),
		// avoiding a full scan on every insert under churn.
		this.byToken.delete(slot.resumeToken);
		this.byToken.set(slot.resumeToken, slot);
		if (this.byToken.size > MAX_RESUME_SLOTS) {
			const oldest = this.byToken.keys().next().value;
			if (oldest !== undefined) this.byToken.delete(oldest);
		}
	}

	touch(token: string, patch: Partial<Omit<ResumeSlot, "resumeToken">>): void {
		const slot = this.byToken.get(token);
		if (!slot) return;
		Object.assign(slot, patch, {lastSeenMs: Date.now()});
		// keep Map order aligned with recency for the LRU eviction in upsert().
		this.byToken.delete(token);
		this.byToken.set(token, slot);
	}
}

function isMissingFile(err: unknown): boolean {
	if (!err || typeof err !== "object" || !("code" in err)) return false;
	const {code} = err;
	return code === "ENOENT";
}
