ALTER TABLE "agent_runners" ADD COLUMN "day_start" text;--> statement-breakpoint
ALTER TABLE "agent_runners" ADD COLUMN "day_end" text;--> statement-breakpoint
ALTER TABLE "agent_runners" ADD COLUMN "briefed_on" date;--> statement-breakpoint
ALTER TABLE "agent_runners" ADD COLUMN "wrapped_on" date;--> statement-breakpoint
ALTER TABLE "agent_secrets" ADD COLUMN "warned_on" date;