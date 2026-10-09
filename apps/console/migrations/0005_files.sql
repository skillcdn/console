CREATE TABLE "blobs" (
	"sha256" text PRIMARY KEY NOT NULL,
	"size" integer NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifacts" ALTER COLUMN "url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "kind" text DEFAULT 'link' NOT NULL;--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "file_name" text;--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "file_size" integer;--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "content_type" text;--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "sha256" text;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_kind_check" CHECK ("artifacts"."kind" in ('link', 'file'));--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_shape_check" CHECK (("artifacts"."kind" = 'link' and "artifacts"."url" is not null) or ("artifacts"."kind" = 'file' and "artifacts"."file_name" is not null and "artifacts"."file_size" is not null and "artifacts"."content_type" is not null and "artifacts"."sha256" is not null));