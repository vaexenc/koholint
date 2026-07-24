import Database from "better-sqlite3";
import {drizzle} from "drizzle-orm/better-sqlite3";
import {migrate} from "drizzle-orm/better-sqlite3/migrator";
import {mkdirSync} from "node:fs";
import path from "node:path";
import {log} from "../log";

// opens (creating if needed) the sqlite db inside dataDir, switches it to WAL
// and applies any pending migrations. everything here is synchronous —
// better-sqlite3 blocks, which is fine at this write volume.
export function openDb(dataDir: string) {
	mkdirSync(dataDir, {recursive: true});
	const file = path.join(dataDir, "koholint.db");
	const sqlite = new Database(file);
	sqlite.pragma("journal_mode = WAL");
	const db = drizzle(sqlite);
	migrate(db, {migrationsFolder: path.join(import.meta.dirname, "migrations")});
	log.info(`db: opened ${file}`);
	return db;
}

export type Db = ReturnType<typeof openDb>;

export function closeDb(db: Db): void {
	db.$client.close();
}
