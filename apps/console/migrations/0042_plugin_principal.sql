ALTER TABLE "plugin_grants" DROP CONSTRAINT "plugin_grants_target_check";--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "via" text;--> statement-breakpoint
ALTER TABLE "plugin_grants" ADD COLUMN "grantee_plugin_key" text;--> statement-breakpoint
CREATE INDEX "plugin_grants_grantee_idx" ON "plugin_grants" USING btree ("workspace_id","grantee_plugin_key");--> statement-breakpoint
ALTER TABLE "plugin_grants" ADD CONSTRAINT "plugin_grants_target_check" CHECK ((("plugin_grants"."person_id" is not null)::int + ("plugin_grants"."project_id" is not null)::int + ("plugin_grants"."grantee_plugin_key" is not null)::int + ("plugin_grants"."everyone")::int) = 1);