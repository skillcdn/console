CREATE TABLE "agent_accounts" (
	"person_id" uuid NOT NULL,
	"service" text NOT NULL,
	"name" text NOT NULL,
	"set_by_id" uuid,
	"agent" text,
	"set_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agent_accounts_person_id_service_pk" PRIMARY KEY("person_id","service")
);
--> statement-breakpoint
ALTER TABLE "agent_accounts" ADD CONSTRAINT "agent_accounts_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_accounts" ADD CONSTRAINT "agent_accounts_set_by_id_people_id_fk" FOREIGN KEY ("set_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;