CREATE TABLE "plugin_cursors" (
	"workspace_id" uuid NOT NULL,
	"plugin_key" text NOT NULL,
	"console_after" bigint DEFAULT 0 NOT NULL,
	"plugin_after" bigint DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plugin_cursors_workspace_id_plugin_key_pk" PRIMARY KEY("workspace_id","plugin_key")
);
--> statement-breakpoint
CREATE TABLE "plugin_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "plugin_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workspace_id" uuid NOT NULL,
	"plugin_key" text NOT NULL,
	"kind" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugin_jobs" (
	"workspace_id" uuid NOT NULL,
	"plugin_key" text NOT NULL,
	"name" text NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_outcome" text,
	"next_at" timestamp with time zone,
	"failed_event_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plugin_jobs_workspace_id_plugin_key_name_pk" PRIMARY KEY("workspace_id","plugin_key","name"),
	CONSTRAINT "plugin_jobs_outcome_check" CHECK ("plugin_jobs"."last_outcome" in ('ok', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "plugin_cursors" ADD CONSTRAINT "plugin_cursors_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_events" ADD CONSTRAINT "plugin_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_jobs" ADD CONSTRAINT "plugin_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plugin_events_plugin_idx" ON "plugin_events" USING btree ("workspace_id","plugin_key","id");--> statement-breakpoint
CREATE INDEX "plugin_links_item_idx" ON "plugin_links" USING btree ("target_kind","target_id");