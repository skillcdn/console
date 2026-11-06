ALTER TABLE "decisions" ADD COLUMN "decider_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
CREATE INDEX "decisions_deciders_idx" ON "decisions" USING gin ("decider_ids");--> statement-breakpoint
-- Every decision of before was addressed to one person (ADR-0042): its list begins as that one (ADR-0057).
UPDATE "decisions" SET "decider_ids" = ARRAY["decider_id"] WHERE "decider_ids" = '{}'::uuid[];
