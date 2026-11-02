import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests create and migrate a database per file.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // The browser tests drive a real Chromium: `pnpm test:browser`, apart from `pnpm check`.
    exclude: [...configDefaults.exclude, "**/*.browser.test.ts"],
  },
});
