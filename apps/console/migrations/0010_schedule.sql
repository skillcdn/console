CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'gray' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_color_check" CHECK ("categories"."color" in ('gray', 'blue', 'green', 'orange', 'pink', 'purple', 'teal', 'yellow'))
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"state" text DEFAULT 'planned' NOT NULL,
	"due_on" date,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goals_state_check" CHECK ("goals"."state" in ('planned', 'active', 'done', 'dropped'))
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "goal_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "goal_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "starts_on" date;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "due_on" date;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "done_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_created_by_id_people_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_key_key" ON "categories" USING btree ("workspace_id","key");--> statement-breakpoint
CREATE INDEX "goals_project_state_idx" ON "goals" USING btree ("project_id","state");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_goal_idx" ON "events" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "tasks_project_due_idx" ON "tasks" USING btree ("project_id","due_on");--> statement-breakpoint
CREATE INDEX "tasks_goal_idx" ON "tasks" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "tasks_category_idx" ON "tasks" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "tasks_assignee_state_idx" ON "tasks" USING btree ("assignee_id","state");--> statement-breakpoint
-- Every workspace starts with the usual kinds of work as its categories (ADR-0019); an
-- administrator renames, recolours, adds and removes them from there. A workspace made after
-- this migration is seeded the same way when it is made.
INSERT INTO "categories" ("workspace_id", "key", "name", "color")
SELECT w."id", c."key", c."name", c."color" FROM "workspaces" w
CROSS JOIN (VALUES ('engineering', 'Engineering', 'blue'), ('product', 'Product', 'purple'), ('design', 'Design', 'pink'), ('marketing', 'Marketing', 'orange'), ('operations', 'Operations', 'teal')) AS c("key", "name", "color");--> statement-breakpoint
-- A task done before the board kept the moment was last changed when it was moved there, as
-- near as the rows can say; a task not yet done has no such moment.
UPDATE "tasks" SET "done_at" = "updated_at" WHERE "state" = 'done';
