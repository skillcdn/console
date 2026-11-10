-- The transcript's own schema (ADR-0086). "events", "files" and "blobs" are partitioned by the
-- month their session began, which is written here by hand: the schema file cannot say it. A
-- month's partitions are made by the console when a session begins in it, and by the worker
-- ahead of time; what becomes of a month that is past is its operator's (deploy/README.md).
CREATE SCHEMA "transcript";
--> statement-breakpoint
CREATE TABLE "transcript"."blobs" (
	"month" text NOT NULL,
	"sha256" text NOT NULL,
	"size" integer NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "blobs_month_sha256_pk" PRIMARY KEY("month","sha256")
) PARTITION BY LIST ("month");
--> statement-breakpoint
CREATE TABLE "transcript"."events" (
	"month" text NOT NULL,
	"session_id" uuid NOT NULL,
	"n" integer NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"text" text NOT NULL,
	"text_sha256" text,
	"text_size" integer,
	"data" jsonb NOT NULL,
	"files" jsonb NOT NULL,
	"sealed_at" timestamp with time zone,
	"sealed_by_id" uuid,
	"sealed_reason" text,
	CONSTRAINT "events_month_session_id_n_pk" PRIMARY KEY("month","session_id","n")
) PARTITION BY LIST ("month");
--> statement-breakpoint
CREATE TABLE "transcript"."files" (
	"month" text NOT NULL,
	"id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"name" text NOT NULL,
	"size" integer NOT NULL,
	"content_type" text NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "files_month_id_pk" PRIMARY KEY("month","id")
) PARTITION BY LIST ("month");
--> statement-breakpoint
CREATE TABLE "transcript"."sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"month" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"ended" text,
	"product" jsonb NOT NULL,
	"model" text,
	"effort" text,
	"resumed" boolean NOT NULL,
	"machine" jsonb NOT NULL,
	"events" integer DEFAULT 0 NOT NULL,
	"last_event_at" timestamp with time zone,
	CONSTRAINT "sessions_ended_check" CHECK (("transcript"."sessions"."ended_at" is null) = ("transcript"."sessions"."ended" is null) and ("transcript"."sessions"."ended" is null or "transcript"."sessions"."ended" in ('stopped', 'restarted', 'reset', 'crashed', 'exited', 'taken_over'))),
	CONSTRAINT "sessions_month_check" CHECK ("transcript"."sessions"."month" ~ '^[0-9]{4}-[0-9]{2}$')
);
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "session_id" uuid;--> statement-breakpoint
CREATE INDEX "files_session_idx" ON "transcript"."files" USING btree ("month","session_id","created_at");--> statement-breakpoint
CREATE INDEX "sessions_person_idx" ON "transcript"."sessions" USING btree ("person_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_open_key" ON "transcript"."sessions" USING btree ("person_id") WHERE "transcript"."sessions"."ended_at" is null;