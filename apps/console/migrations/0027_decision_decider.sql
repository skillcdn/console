-- A decision is addressed to one person (ADR-0042): the decisions there were are addressed to
-- whoever raised them, which is whom they waited for in practice; then the column is required.
ALTER TABLE "decisions" ADD COLUMN "decider_id" uuid;--> statement-breakpoint
UPDATE "decisions" SET "decider_id" = "raised_by_id";--> statement-breakpoint
ALTER TABLE "decisions" ALTER COLUMN "decider_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_decider_id_people_id_fk" FOREIGN KEY ("decider_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decisions_decider_open_idx" ON "decisions" USING btree ("decider_id","answered_at");
