import { defineConfig } from "vitest/config";

// The browser tests alone (`*.browser.test.ts`): a real Chromium of Playwright's against the
// console listening on this machine, one file at a time. `pnpm test:browser`.
export default defineConfig({
  test: {
    include: ["src/**/*.browser.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
