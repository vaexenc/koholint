import type {Direction} from "@/game/types";
import {index, integer, real, sqliteTable, text} from "drizzle-orm/sqlite-core";

// kept literal (not the widened Direction[] used elsewhere) so the facing
// column infers the exact union. `satisfies` fails to compile if a value here
// stops being a Direction, or a new Direction is added without landing here.
const DIRECTIONS = ["up", "down", "left", "right"] satisfies [Direction, ...Direction[]];

export const feedback = sqliteTable(
	"feedback",
	{
		id: text("id").primaryKey(),
		// display name claimed by the sender at submit time; null when the client
		// sent none or it failed the name rules.
		name: text("name"),
		message: text("message").notNull(),
		createdAtMs: integer("created_at_ms").notNull(),
		read: integer("read", {mode: "boolean"}).notNull().default(false),
	},
	(table) => [index("feedback_created_at_ms_idx").on(table.createdAtMs)]
);

export const resumeSlots = sqliteTable(
	"resume_slots",
	{
		resumeToken: text("resume_token").primaryKey(),
		connId: text("conn_id").notNull(),
		idIndex: integer("id_index").notNull(),
		name: text("name").notNull(),
		avatarId: text("avatar_id").notNull(),
		paletteId: text("palette_id"),
		x: real("x").notNull(),
		y: real("y").notNull(),
		facing: text("facing", {enum: DIRECTIONS}).notNull(),
		lastSeenMs: integer("last_seen_ms").notNull(),
	},
	(table) => [index("resume_slots_last_seen_ms_idx").on(table.lastSeenMs)]
);
