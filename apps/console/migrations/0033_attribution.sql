ALTER TABLE "decisions" ADD COLUMN "answered_agent" text;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "outcome_by_id" uuid;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "outcome_agent" text;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "outcome_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "agent" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "agent" text;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_outcome_by_id_people_id_fk" FOREIGN KEY ("outcome_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- The feed knew all along (ADR-0021): the agent beside the person on every event. The records take
-- it from there once (ADR-0056); a row the feed does not know keeps null, the person themselves.
UPDATE "decisions" SET "answered_agent" = e."agent" FROM "events" e WHERE e."kind" = 'decision.answered' AND e."decision_id" = "decisions"."id" AND e."agent" IS NOT NULL;--> statement-breakpoint
UPDATE "decisions" SET "outcome_by_id" = e."actor_id", "outcome_agent" = e."agent", "outcome_at" = e."created_at" FROM (SELECT DISTINCT ON ("decision_id") "decision_id", "actor_id", "agent", "created_at" FROM "events" WHERE "kind" = 'decision.updated' AND "data"->'fields' ? 'outcome' ORDER BY "decision_id", "created_at" DESC, "id" DESC) e WHERE e."decision_id" = "decisions"."id" AND "decisions"."outcome" IS NOT NULL;--> statement-breakpoint
UPDATE "tasks" SET "agent" = e."agent" FROM "events" e WHERE e."kind" = 'task.created' AND e."task_id" = "tasks"."id" AND e."agent" IS NOT NULL;--> statement-breakpoint
UPDATE "goals" SET "agent" = e."agent" FROM "events" e WHERE e."kind" = 'goal.created' AND e."goal_id" = "goals"."id" AND e."agent" IS NOT NULL;
