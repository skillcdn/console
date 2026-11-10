ALTER TABLE "workspaces" ADD COLUMN "handle" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "domain" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "services" jsonb DEFAULT '{}'::jsonb NOT NULL;