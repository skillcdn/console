CREATE TABLE "plugin_keyed_secrets" (
	"workspace_id" uuid NOT NULL,
	"plugin_key" text NOT NULL,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"sealed" text NOT NULL,
	"set_at" timestamp with time zone NOT NULL,
	"set_by" uuid,
	"expires_at" timestamp with time zone,
	"source" text NOT NULL,
	CONSTRAINT "plugin_keyed_secrets_workspace_id_plugin_key_name_key_pk" PRIMARY KEY("workspace_id","plugin_key","name","key")
);
--> statement-breakpoint
ALTER TABLE "plugin_keyed_secrets" ADD CONSTRAINT "plugin_keyed_secrets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_keyed_secrets" ADD CONSTRAINT "plugin_keyed_secrets_set_by_people_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;