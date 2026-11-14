import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import webConfig from "../../web/vite.config.js";
import { FIXTURE_PATH } from "./browser-console.js";
import { CONSOLE_PATHS, ownPage, PARTS_PATH } from "./live-pages.js";

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

  it("answers the parts' page at its address, with what the address asks kept", () => {
    expect(ownPage("/parts")).toBe("/parts.html");
    expect(ownPage("/parts/")).toBe("/parts.html");
    expect(ownPage("/parts?lang=ko")).toBe("/parts.html?lang=ko");
    expect(ownPage("/parts/?lang=ko")).toBe("/parts.html?lang=ko");
  });

  it("leaves every other path to the console, a project named as the page is among them", () => {
    for (const url of [
      "/",
      "/partsx",
      "/parts/button",
      "/projects/parts",
      "/PARTS",
      "/?next=/parts",
      "/api/v1/parts",
    ]) {
      expect(ownPage(url), url).toBeUndefined();
    }
  });

  it("keeps the page out of what the console answers itself", () => {
    // A path sent on to the console would never reach the page.
    for (const prefix of CONSOLE_PATHS) {
      expect(PARTS_PATH.startsWith(prefix)).toBe(false);
    }
  });

  it("is a page the web app's sources hold and its build is not told to read", () => {
    const web = fileURLToPath(new URL("../../web/", import.meta.url));
    expect(existsSync(`${web}parts.html`)).toBe(true);
    // The build reads the console's page alone, unless the configuration names more to read.
    const named = [webConfig.build?.rolldownOptions?.input, webConfig.build?.rollupOptions?.input];
    expect(JSON.stringify(named)).not.toContain("parts");
  });
});
