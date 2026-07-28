import {desc, notInArray} from "drizzle-orm";
import type {SQLiteColumn, SQLiteTable} from "drizzle-orm/sqlite-core";
import type {Db} from "./index";

// sheds the rows with the lowest `age` value beyond `cap`, keeping a table
// bounded no matter how much churn it sees. stated as "keep the newest `cap`,
// delete the rest": one statement whose subquery rides the index on `age`, so
// the usual case — a table still under the cap, which is every insert until
// churn catches up — is a bounded index scan that deletes nothing. counting the
// table first to decide whether to bother made every insert pay a full scan for
// an answer that was almost always "no". the general form also self-heals a
// pre-existing overage.
export function evictPastCap(
	db: Db,
	table: SQLiteTable,
	key: SQLiteColumn,
	age: SQLiteColumn,
	cap: number
): void {
	const keep = db.select({key}).from(table).orderBy(desc(age)).limit(cap);
	db.delete(table).where(notInArray(key, keep)).run();
}
