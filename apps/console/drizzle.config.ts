import { defineConfig } from "drizzle-kit";

// Used by `pnpm --filter @skillcdn/console-app run generate --name <what-changed>` only.
// Generating needs no database: it diffs src/db/schema.ts against the last snapshot.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./migrations",
  casing: "snake_case",
});
