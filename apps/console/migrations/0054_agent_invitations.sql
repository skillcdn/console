CREATE TABLE "agent_invitations" (
	"person_id" uuid PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"created_by_id" uuid NOT NULL,
	"agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_invitations" ADD CONSTRAINT "agent_invitations_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_invitations" ADD CONSTRAINT "agent_invitations_created_by_id_people_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_invitations_code_key" ON "agent_invitations" USING btree ("code_hash");