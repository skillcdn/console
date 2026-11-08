ALTER TABLE "plugin_secrets" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plugin_secrets" ADD COLUMN "source" text DEFAULT 'administrator' NOT NULL;