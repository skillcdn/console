ALTER TABLE "connect_requests" ADD COLUMN "as" text DEFAULT 'agent' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "kind" text DEFAULT 'browser' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "connect_requests" ADD CONSTRAINT "connect_requests_as_check" CHECK ("connect_requests"."as" in ('agent', 'self'));--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_kind_check" CHECK ("sessions"."kind" in ('browser', 'command'));