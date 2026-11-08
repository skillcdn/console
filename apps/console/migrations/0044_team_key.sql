ALTER TABLE "teams" ADD COLUMN "key" text;--> statement-breakpoint
-- A team made before keys (ADR-0074) is called by one drawn from its id, which no other team has;
-- an administrator who wants one that reads better makes the team anew under it.
UPDATE "teams" SET "key" = 'team-' || replace("id"::text, '-', '') WHERE "key" IS NULL;--> statement-breakpoint
ALTER TABLE "teams" ALTER COLUMN "key" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "teams_key_key" ON "teams" USING btree ("workspace_id","key");
