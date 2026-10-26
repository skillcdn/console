-- The one assignee became the first of the workers in 0.3.2 (ADR-0037, migration 0025), and the
-- column stayed one release unused, as the rollout contract asks (expand, then contract). Nothing
-- reads it; this release drops its foreign key, its index and the column.
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_assignee_id_people_id_fk";
--> statement-breakpoint
DROP INDEX "tasks_assignee_state_idx";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "assignee_id";
