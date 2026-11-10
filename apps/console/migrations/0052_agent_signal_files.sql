CREATE TABLE "agent_signal_files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"person_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"name" text NOT NULL,
	"size" integer NOT NULL,
	"content_type" text NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_signal_files" ADD CONSTRAINT "agent_signal_files_signal_fk" FOREIGN KEY ("person_id","number") REFERENCES "public"."agent_signals"("person_id","number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_signal_files_signal_idx" ON "agent_signal_files" USING btree ("person_id","number");