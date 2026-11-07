-- The front page holds a grid of tiles now (ADR-0061): what was kept as a list of widgets reads as nothing arranged yet.
UPDATE "people" SET "home" = NULL WHERE "home" IS NOT NULL;
