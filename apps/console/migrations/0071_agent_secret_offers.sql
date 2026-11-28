CREATE TABLE "agent_secret_offers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"person_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sealed" text,
	"note" text,
	"expires_on" date,
	"offered_by_id" uuid,
	"agent" text,
	"state" text DEFAULT 'waiting' NOT NULL,
	"taken_as" text,
	"ends_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agent_secret_offers_state_check" CHECK ("agent_secret_offers"."state" in ('waiting', 'taken', 'left', 'lapsed')),
	CONSTRAINT "agent_secret_offers_sealed_check" CHECK (("agent_secret_offers"."state" = 'waiting') = ("agent_secret_offers"."sealed" is not null))
);
--> statement-breakpoint
ALTER TABLE "agent_secret_offers" ADD CONSTRAINT "agent_secret_offers_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_secret_offers" ADD CONSTRAINT "agent_secret_offers_offered_by_id_people_id_fk" FOREIGN KEY ("offered_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_secret_offers_person_idx" ON "agent_secret_offers" USING btree ("person_id","created_at");