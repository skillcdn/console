CREATE TABLE "workspace_pack_connects" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
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
ALTER TABLE "workspaces" ADD COLUMN "pack_token" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "pack_token_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace_pack_connects" ADD CONSTRAINT "workspace_pack_connects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_pack_connects" ADD CONSTRAINT "workspace_pack_connects_started_by_id_people_id_fk" FOREIGN KEY ("started_by_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_pack_connects_expires_idx" ON "workspace_pack_connects" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_pack_token_check" CHECK (("workspaces"."pack_token" is null) = ("workspaces"."pack_token_set_at" is null));