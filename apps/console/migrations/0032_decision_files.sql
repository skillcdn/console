CREATE TABLE "decision_files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"decision_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"file_size" integer NOT NULL,
	"content_type" text NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "decision_files" ADD CONSTRAINT "decision_files_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decision_files_decision_idx" ON "decision_files" USING btree ("decision_id");