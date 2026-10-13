ALTER TABLE "goals" ADD COLUMN "starts_on" date;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goals_category_idx" ON "goals" USING btree ("category_id");