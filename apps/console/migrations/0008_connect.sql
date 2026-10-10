CREATE TABLE "connect_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"code" text NOT NULL,
	"secret_hash" text NOT NULL,
	"agent" text NOT NULL,
	"approved_by_id" uuid,
	"name" text,
	"token_days" integer,
	"approved_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connect_requests" ADD CONSTRAINT "connect_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connect_requests" ADD CONSTRAINT "connect_requests_approved_by_id_people_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connect_requests_code_key" ON "connect_requests" USING btree ("workspace_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "connect_requests_secret_hash_key" ON "connect_requests" USING btree ("secret_hash");--> statement-breakpoint
CREATE INDEX "connect_requests_expires_idx" ON "connect_requests" USING btree ("expires_at");