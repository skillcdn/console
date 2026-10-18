CREATE TABLE "task_workers" (
	"task_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_workers_pkey" PRIMARY KEY("task_id","person_id")
);
--> statement-breakpoint
ALTER TABLE "task_workers" ADD CONSTRAINT "task_workers_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_workers" ADD CONSTRAINT "task_workers_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_workers_person_idx" ON "task_workers" USING btree ("person_id");--> statement-breakpoint
-- The one person a task was assigned to becomes its first worker (ADR-0037), as of when the
-- task was last changed, as near as the rows can say. The column stays, unused, until the next
-- release (expand, then contract).
INSERT INTO "task_workers" ("task_id", "person_id", "added_at")
SELECT "id", "assignee_id", "updated_at" FROM "tasks" WHERE "assignee_id" IS NOT NULL;