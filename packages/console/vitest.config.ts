import { defineConfig } from "vitest/config";

// The template of a plugin ships with the package and carries tests of its own, which run in the
// plugin `console-plugin init` writes (examples/plugin-hello in this repository), not here.
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "template/**"],
  },
});
