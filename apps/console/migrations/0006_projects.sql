CREATE TABLE "project_members" (
	"project_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_members_pkey" PRIMARY KEY("project_id","person_id"),
	CONSTRAINT "project_members_role_check" CHECK ("project_members"."role" in ('owner', 'member'))
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"skills_address" text,
	"next_task_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_visibility_check" CHECK ("projects"."visibility" in ('workspace', 'private'))
);
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "projects_key_key" ON "projects" USING btree ("workspace_id","key");--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_members_person_idx" ON "project_members" USING btree ("person_id");--> statement-breakpoint
-- The board as it was becomes the project `general` of every workspace, open to everyone of it,
-- with the task counter the workspace had (ADR-0008): nothing is lost, and nobody loses sight of it.
INSERT INTO "projects" ("workspace_id", "key", "name", "description", "visibility", "next_task_number")
SELECT "id", 'general', 'General', 'The board as it was before projects.', 'workspace', "next_task_number" FROM "workspaces";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "project_id" uuid;--> statement-breakpoint
UPDATE "tasks" SET "project_id" = p."id" FROM "projects" p WHERE p."workspace_id" = "tasks"."workspace_id" AND p."key" = 'general';--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "project_id" uuid;--> statement-breakpoint
UPDATE "runs" SET "project_id" = p."id" FROM "projects" p WHERE p."workspace_id" = "runs"."workspace_id" AND p."key" = 'general';--> statement-breakpoint
ALTER TABLE "runs" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "project_id" uuid;--> statement-breakpoint
UPDATE "decisions" SET "project_id" = p."id" FROM "projects" p WHERE p."workspace_id" = "decisions"."workspace_id" AND p."key" = 'general';--> statement-breakpoint
ALTER TABLE "decisions" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "agent" text;--> statement-breakpoint
-- What happened to the board happened in `general`; what happened to the workspace's people stays its own.
UPDATE "events" SET "project_id" = p."id" FROM "projects" p WHERE p."workspace_id" = "events"."workspace_id" AND p."key" = 'general' AND ("events"."task_id" IS NOT NULL OR "events"."run_id" IS NOT NULL OR "events"."decision_id" IS NOT NULL);--> statement-breakpoint
-- What an agent did names the agent: the events of runs, and the decisions raised from them, said so in their data.
UPDATE "events" SET "agent" = "data"->>'agent' WHERE "data" ? 'agent' AND ("data"->>'agent') <> '';--> statement-breakpoint
DROP INDEX "decisions_open_idx";--> statement-breakpoint
DROP INDEX "runs_status_idx";--> statement-breakpoint
DROP INDEX "tasks_number_key";--> statement-breakpoint
DROP INDEX "tasks_state_idx";--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decisions_project_open_idx" ON "decisions" USING btree ("project_id","answered_at");--> statement-breakpoint
CREATE INDEX "events_project_idx" ON "events" USING btree ("project_id","id");--> statement-breakpoint
CREATE INDEX "events_task_idx" ON "events" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "events_run_idx" ON "events" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "events_decision_idx" ON "events" USING btree ("decision_id");--> statement-breakpoint
CREATE INDEX "runs_project_status_idx" ON "runs" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_project_number_key" ON "tasks" USING btree ("project_id","number");--> statement-breakpoint
CREATE INDEX "tasks_project_state_idx" ON "tasks" USING btree ("project_id","state");
