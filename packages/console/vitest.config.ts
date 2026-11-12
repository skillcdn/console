import { defineConfig } from "vitest/config";

// The template of a plugin ships with the package and carries tests of its own, which run in the
// plugin `console-plugin init` writes (examples/plugin-hello in this repository), not here.
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "template/**"],
    // Some tests here start a process, write a tree of files or draw a picture pixel by pixel.
    // `pnpm check` runs every workspace's tests at once, and on a machine busy with that each
    // has taken longer than the five seconds a test gets by default, a different one each run.
    testTimeout: 20_000,
  },
});
