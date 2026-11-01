CREATE TABLE "plugin_grants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"plugin_key" text NOT NULL,
	"role" text NOT NULL,
	"person_id" uuid,
	"project_id" uuid,
	"everyone" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "plugin_grants_target_check" CHECK ((("plugin_grants"."person_id" is not null)::int + ("plugin_grants"."project_id" is not null)::int + ("plugin_grants"."everyone")::int) = 1)
);
--> statement-breakpoint
CREATE TABLE "plugin_installs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"key" text NOT NULL,
	"package_name" text NOT NULL,
	"version" text NOT NULL,
	"data_version" integer DEFAULT 1 NOT NULL,
	"state" text NOT NULL,
	"consent" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"board_project_id" uuid,
	"projects" jsonb DEFAULT '"all"'::jsonb NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled_at" timestamp with time zone,
	"enabled_by" uuid,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plugin_installs_state_check" CHECK ("plugin_installs"."state" in ('enabled', 'disabled', 'needs_consent'))
);
--> statement-breakpoint
CREATE TABLE "plugin_secrets" (
	"workspace_id" uuid NOT NULL,
	"plugin_key" text NOT NULL,
	"name" text NOT NULL,
	"sealed" text NOT NULL,
	"set_at" timestamp with time zone NOT NULL,
	"set_by" uuid,
	CONSTRAINT "plugin_secrets_workspace_id_plugin_key_name_pk" PRIMARY KEY("workspace_id","plugin_key","name")
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "plugin" text;--> statement-breakpoint
ALTER TABLE "plugin_grants" ADD CONSTRAINT "plugin_grants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_grants" ADD CONSTRAINT "plugin_grants_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_grants" ADD CONSTRAINT "plugin_grants_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_grants" ADD CONSTRAINT "plugin_grants_created_by_people_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_installs" ADD CONSTRAINT "plugin_installs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_installs" ADD CONSTRAINT "plugin_installs_board_project_id_projects_id_fk" FOREIGN KEY ("board_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_installs" ADD CONSTRAINT "plugin_installs_enabled_by_people_id_fk" FOREIGN KEY ("enabled_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_secrets" ADD CONSTRAINT "plugin_secrets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_secrets" ADD CONSTRAINT "plugin_secrets_set_by_people_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plugin_grants_plugin_idx" ON "plugin_grants" USING btree ("workspace_id","plugin_key");--> statement-breakpoint
CREATE INDEX "plugin_grants_person_idx" ON "plugin_grants" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "plugin_grants_project_idx" ON "plugin_grants" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plugin_installs_key_key" ON "plugin_installs" USING btree ("workspace_id","key");--> statement-breakpoint
CREATE INDEX "plugin_installs_board_idx" ON "plugin_installs" USING btree ("board_project_id");--> statement-breakpoint
CREATE INDEX "events_plugin_idx" ON "events" USING btree ("workspace_id","plugin","id");