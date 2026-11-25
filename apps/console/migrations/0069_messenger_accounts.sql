CREATE TABLE "messenger_accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"messenger" text NOT NULL,
	"team" text NOT NULL,
	"account" text NOT NULL,
	"person_id" uuid NOT NULL,
	"plugin" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messenger_accounts" ADD CONSTRAINT "messenger_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messenger_accounts" ADD CONSTRAINT "messenger_accounts_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "messenger_accounts_account_key" ON "messenger_accounts" USING btree ("workspace_id","messenger","team","account");--> statement-breakpoint
CREATE UNIQUE INDEX "messenger_accounts_person_key" ON "messenger_accounts" USING btree ("workspace_id","messenger","team","person_id");--> statement-breakpoint
CREATE INDEX "messenger_accounts_person_idx" ON "messenger_accounts" USING btree ("person_id");