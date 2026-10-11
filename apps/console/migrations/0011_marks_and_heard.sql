ALTER TABLE "projects" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "symbol" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "last_heard_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_color_check" CHECK ("projects"."color" is null or "projects"."color" in ('gray', 'blue', 'green', 'orange', 'pink', 'purple', 'teal', 'yellow'));--> statement-breakpoint
-- A run begun before the board kept when it last heard from the agent was last heard from when
-- it was last changed, as near as the rows can say.
UPDATE "runs" SET "last_heard_at" = "updated_at";
