CREATE TABLE "agent_secret_accesses" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "agent_secret_accesses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"person_id" uuid NOT NULL,
	"name" text NOT NULL,
	"action" text NOT NULL,
	"actor_id" uuid,
	"agent" text,
	"seeded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_secret_accesses_action_check" CHECK ("agent_secret_accesses"."action" in ('set', 'read', 'removed'))
);
--> statement-breakpoint
CREATE TABLE "agent_secrets" (
	"person_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sealed" text NOT NULL,
	"expires_on" date,
	"seeded" boolean DEFAULT false NOT NULL,
	"set_by_id" uuid,
	"set_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_secrets_person_id_name_pk" PRIMARY KEY("person_id","name")
);
--> statement-breakpoint
ALTER TABLE "agent_secret_accesses" ADD CONSTRAINT "agent_secret_accesses_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_secret_accesses" ADD CONSTRAINT "agent_secret_accesses_actor_id_people_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_secrets" ADD CONSTRAINT "agent_secrets_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_secrets" ADD CONSTRAINT "agent_secrets_set_by_id_people_id_fk" FOREIGN KEY ("set_by_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_secret_accesses_person_idx" ON "agent_secret_accesses" USING btree ("person_id","id");