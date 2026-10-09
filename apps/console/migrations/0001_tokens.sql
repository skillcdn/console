CREATE TABLE "tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"person_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tokens_token_hash_key" ON "tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "tokens_person_idx" ON "tokens" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "tokens_expires_idx" ON "tokens" USING btree ("expires_at");