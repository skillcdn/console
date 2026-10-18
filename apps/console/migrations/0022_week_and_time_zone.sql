ALTER TABLE "workspaces" ADD COLUMN "week_start" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "time_zone" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_week_start_check" CHECK ("workspaces"."week_start" in ('auto', 'monday', 'sunday'));