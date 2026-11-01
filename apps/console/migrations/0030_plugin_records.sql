CREATE TABLE "plugin_links" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"plugin_key" text NOT NULL,
	"record_id" uuid,
	"target_kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"target_plugin" text,
	"target_collection" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plugin_links_kind_check" CHECK ("plugin_links"."target_kind" in ('task', 'decision', 'document', 'project', 'run', 'record'))
);
--> statement-breakpoint
CREATE TABLE "plugin_record_files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"plugin_key" text NOT NULL,
	"record_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"file_size" integer NOT NULL,
	"content_type" text NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"agent" text
);
--> statement-breakpoint
CREATE TABLE "plugin_record_versions" (
	"record_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"data" jsonb NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"by_id" uuid,
	"agent" text,
	CONSTRAINT "plugin_record_versions_record_id_version_pk" PRIMARY KEY("record_id","version")
);
--> statement-breakpoint
CREATE TABLE "plugin_records" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"plugin_key" text NOT NULL,
	"collection" text NOT NULL,
	"project_id" uuid,
	"owner_id" uuid,
	"data" jsonb NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', "search_text")) STORED,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"created_agent" text,
	"updated_by_id" uuid,
	"updated_agent" text,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "plugin_uploads" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"plugin_key" text NOT NULL,
	"person_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"file_size" integer NOT NULL,
	"content_type" text NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plugin_links" ADD CONSTRAINT "plugin_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_links" ADD CONSTRAINT "plugin_links_record_id_plugin_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."plugin_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_record_files" ADD CONSTRAINT "plugin_record_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_record_files" ADD CONSTRAINT "plugin_record_files_record_id_plugin_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."plugin_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_record_files" ADD CONSTRAINT "plugin_record_files_created_by_id_people_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_record_versions" ADD CONSTRAINT "plugin_record_versions_record_id_plugin_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."plugin_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_record_versions" ADD CONSTRAINT "plugin_record_versions_by_id_people_id_fk" FOREIGN KEY ("by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_records" ADD CONSTRAINT "plugin_records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_records" ADD CONSTRAINT "plugin_records_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_records" ADD CONSTRAINT "plugin_records_owner_id_people_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_records" ADD CONSTRAINT "plugin_records_created_by_id_people_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_records" ADD CONSTRAINT "plugin_records_updated_by_id_people_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_uploads" ADD CONSTRAINT "plugin_uploads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_uploads" ADD CONSTRAINT "plugin_uploads_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plugin_links_record_target_key" ON "plugin_links" USING btree ("record_id","target_kind","target_id");--> statement-breakpoint
CREATE INDEX "plugin_links_target_idx" ON "plugin_links" USING btree ("workspace_id","plugin_key","target_kind","target_id");--> statement-breakpoint
CREATE INDEX "plugin_record_files_record_idx" ON "plugin_record_files" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "plugin_record_files_plugin_idx" ON "plugin_record_files" USING btree ("workspace_id","plugin_key");--> statement-breakpoint
CREATE INDEX "plugin_records_collection_idx" ON "plugin_records" USING btree ("workspace_id","plugin_key","collection","id");--> statement-breakpoint
CREATE INDEX "plugin_records_project_idx" ON "plugin_records" USING btree ("plugin_key","collection","project_id");--> statement-breakpoint
CREATE INDEX "plugin_records_owner_idx" ON "plugin_records" USING btree ("plugin_key","collection","owner_id");--> statement-breakpoint
CREATE INDEX "plugin_records_data_idx" ON "plugin_records" USING gin ("data" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "plugin_records_search_idx" ON "plugin_records" USING gin ("search");--> statement-breakpoint
CREATE INDEX "plugin_uploads_expires_idx" ON "plugin_uploads" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "plugin_uploads_plugin_idx" ON "plugin_uploads" USING btree ("workspace_id","plugin_key");