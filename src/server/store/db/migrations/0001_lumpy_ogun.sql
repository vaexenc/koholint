CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`message` text NOT NULL,
	`created_at_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `feedback_created_at_ms_idx` ON `feedback` (`created_at_ms`);