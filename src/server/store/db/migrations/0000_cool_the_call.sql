CREATE TABLE `resume_slots` (
	`resume_token` text PRIMARY KEY NOT NULL,
	`conn_id` text NOT NULL,
	`id_index` integer NOT NULL,
	`name` text NOT NULL,
	`avatar_id` text NOT NULL,
	`palette_id` text,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`facing` text NOT NULL,
	`last_seen_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `resume_slots_last_seen_ms_idx` ON `resume_slots` (`last_seen_ms`);