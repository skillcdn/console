ALTER TABLE "people" ADD COLUMN "email" text;--> statement-breakpoint
CREATE UNIQUE INDEX "people_email_key" ON "people" USING btree ("workspace_id","email") WHERE "people"."email" is not null;