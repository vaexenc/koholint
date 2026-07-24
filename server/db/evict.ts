import {asc, count, inArray} from "drizzle-orm";
import type {SQLiteColumn, SQLiteTable} from "drizzle-orm/sqlite-core";
import type {Db} from "./index";

// sheds the rows with the lowest `age` value beyond `cap`, keeping a table
// bounded no matter how much churn it sees. normally a no-op or a single
// deletion since each insert adds at most one row; the general form also
// self-heals a pre-existing overage.
export function evictPastCap(
	db: Db,
	table: SQLiteTable,
	key: SQLiteColumn,
	age: SQLiteColumn,
	cap: number
): void {
	const total = db.select({total: count()}).from(table).get();
	const excess = (total?.total ?? 0) - cap;
	if (excess <= 0) return;
	const oldest = db.select({key}).from(table).orderBy(asc(age)).limit(excess);
	db.delete(table).where(inArray(key, oldest)).run();
}
