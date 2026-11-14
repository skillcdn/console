import { describe, expect, it } from "vitest";
import webConfig from "../../web/vite.config.js";
import { FIXTURE_PATH } from "./browser-console.js";
import { CONSOLE_PATHS } from "./live-pages.js";

describe("the pages served in front of a console", () => {
  it("sends on what the web app's own development server sends to an api, under the same names", () => {
    // The same names, so that these take the place of the web app's own, which point at an
    // `api` role nobody runs here; a path named there and not here would go to that role.
    const own = Object.keys(webConfig.server?.proxy ?? {});
    expect(own.length).toBeGreaterThan(0);
    for (const prefix of own) {
      expect(CONSOLE_PATHS).toContain(prefix);
    }
  });

  it("sends on the fixture's sign-in, which the web app knows nothing of", () => {
    expect(CONSOLE_PATHS).toContain(FIXTURE_PATH);
  });
});
