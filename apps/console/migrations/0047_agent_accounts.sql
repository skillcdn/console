ALTER TABLE "people" ALTER COLUMN "host_account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ALTER COLUMN "last_login_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "kind" text DEFAULT 'person' NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "handle" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "avatar_seed" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "avatar_parts" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "people_unbound_login_key" ON "people" USING btree ("workspace_id","host",lower("login")) WHERE "people"."host_account_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "people_handle_key" ON "people" USING btree ("workspace_id","handle") WHERE "people"."handle" is not null;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_kind_check" CHECK ("people"."kind" in ('person', 'agent'));--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_agent_check" CHECK (("people"."kind" = 'agent') = ("people"."handle" is not null) and ("people"."kind" = 'agent') = ("people"."avatar_parts" is not null));--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_agent_standing_check" CHECK ("people"."kind" <> 'agent' or ("people"."role" = 'member' and "people"."manager_id" is not null));--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_signed_in_check" CHECK ("people"."kind" = 'agent' or ("people"."host_account_id" is not null and "people"."last_login_at" is not null));