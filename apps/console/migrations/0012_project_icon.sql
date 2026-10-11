ALTER TABLE "projects" ADD COLUMN "icon_sha256" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "icon_content_type" text;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_icon_check" CHECK (("projects"."icon_sha256" is null) = ("projects"."icon_content_type" is null));