CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"host" text NOT NULL,
	"login" text NOT NULL,
	"person_id" uuid,
	"listed_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listings_host_check" CHECK ("listings"."host" in ('gh', 'google'))
);
--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "source" text DEFAULT 'listed' NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "deactivated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_listed_by_id_people_id_fk" FOREIGN KEY ("listed_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "listings_login_key" ON "listings" USING btree ("workspace_id","host",lower("login"));--> statement-breakpoint
CREATE INDEX "listings_person_idx" ON "listings" USING btree ("person_id");--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_status_check" CHECK ("people"."status" in ('active', 'deactivated'));--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_source_check" CHECK ("people"."source" in ('organization', 'domain', 'listed'));--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_deactivated_check" CHECK (("people"."status" = 'deactivated') = ("people"."deactivated_at" is not null));--> statement-breakpoint
UPDATE "people" SET "source" = 'domain' WHERE "host" = 'google';
