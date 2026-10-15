ALTER TABLE "projects" ADD COLUMN "pack_token" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "pack_token_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_pack_token_check" CHECK (("projects"."pack_token" is null) = ("projects"."pack_token_set_at" is null));