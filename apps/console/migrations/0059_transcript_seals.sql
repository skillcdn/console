ALTER TABLE "transcript"."sessions" ADD COLUMN "sealed" integer[] DEFAULT '{}'::integer[] NOT NULL;--> statement-breakpoint
-- The events sealed before a session kept their numbers: those of the months that are with the database, in the order they were sealed. A month that is away is held to nothing it did not leave with.
UPDATE "transcript"."sessions" s SET "sealed" = found."numbers"
FROM (
	SELECT e."session_id", array_agg(e."n" ORDER BY e."sealed_at", e."n") AS "numbers"
	FROM "transcript"."events" e
	WHERE e."sealed_at" IS NOT NULL
	GROUP BY e."session_id"
) found
WHERE found."session_id" = s."id";
