CREATE TABLE "agent_wake_cursors" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"after" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_wake_cursors" ADD CONSTRAINT "agent_wake_cursors_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- A workspace that had a history before the rules begins at the feed's end: nobody is woken for what is past.
INSERT INTO "agent_wake_cursors" ("workspace_id", "after")
SELECT w."id", coalesce((SELECT max(e."id") FROM "events" e WHERE e."workspace_id" = w."id"), 0)
FROM "workspaces" w;
