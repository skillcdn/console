ALTER TABLE "people" ADD COLUMN "role" text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_role_check" CHECK ("people"."role" in ('admin', 'member'));