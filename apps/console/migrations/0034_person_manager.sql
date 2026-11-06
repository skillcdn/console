ALTER TABLE "people" ADD COLUMN "manager_id" uuid;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_manager_id_people_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "people_manager_idx" ON "people" USING btree ("manager_id");