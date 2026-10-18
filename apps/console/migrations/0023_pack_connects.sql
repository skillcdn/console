CREATE TABLE "pack_connects" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"code" text NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"interval_seconds" integer NOT NULL,
	"started_by_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pack_connects" ADD CONSTRAINT "pack_connects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_connects" ADD CONSTRAINT "pack_connects_started_by_id_people_id_fk" FOREIGN KEY ("started_by_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pack_connects_expires_idx" ON "pack_connects" USING btree ("expires_at");