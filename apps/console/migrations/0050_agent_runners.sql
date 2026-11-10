CREATE TABLE "agent_runners" (
	"person_id" uuid PRIMARY KEY NOT NULL,
	"state" text,
	"reason" text,
	"state_at" timestamp with time zone,
	"heard_at" timestamp with time zone,
	"delivered" integer DEFAULT 0 NOT NULL,
	"next_signal" integer DEFAULT 1 NOT NULL,
	"stop_signal" integer,
	"session_id" uuid,
	"machine" jsonb,
	"runner" text,
	"product" jsonb,
	"offers" jsonb,
	"running" jsonb,
	"model" text,
	"effort" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_runners_state_check" CHECK ("agent_runners"."state" is null or "agent_runners"."state" in ('running', 'stopped', 'refused', 'failed', 'unheard'))
);
--> statement-breakpoint
CREATE TABLE "agent_signals" (
	"person_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"kind" text NOT NULL,
	"by_id" uuid,
	"agent" text,
	"plugin" text,
	"source" text NOT NULL,
	"key" text,
	"text" text DEFAULT '' NOT NULL,
	"set" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_signals_person_id_number_pk" PRIMARY KEY("person_id","number"),
	CONSTRAINT "agent_signals_kind_check" CHECK ("agent_signals"."kind" in ('wake', 'tell', 'interrupt', 'stop', 'restart', 'reset', 'set')),
	CONSTRAINT "agent_signals_source_check" CHECK ("agent_signals"."source" in ('person', 'board', 'schedule', 'messenger', 'console'))
);
--> statement-breakpoint
ALTER TABLE "agent_runners" ADD CONSTRAINT "agent_runners_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_signals" ADD CONSTRAINT "agent_signals_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_signals" ADD CONSTRAINT "agent_signals_by_id_people_id_fk" FOREIGN KEY ("by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runners_heard_idx" ON "agent_runners" USING btree ("heard_at");