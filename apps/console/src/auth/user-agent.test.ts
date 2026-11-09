import { describe, expect, it } from "vitest";
import { describeUserAgent } from "./user-agent.js";

describe("describeUserAgent", () => {
  it("names the browser and the platform by family, the browser built on another by its own name", () => {
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
      ),
    ).toEqual({ browser: "Chrome", platform: "Windows" });
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0",
      ),
    ).toEqual({ browser: "Edge", platform: "Windows" });
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
      ),
    ).toEqual({ browser: "Safari", platform: "macOS" });
    expect(
      describeUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0.0.0 Mobile/15E148 Safari/604.1",
      ),
    ).toEqual({ browser: "Chrome", platform: "iOS" });
    expect(
      describeUserAgent("Mozilla/5.0 (Android 15; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0"),
    ).toEqual({ browser: "Firefox", platform: "Android" });
    expect(
      describeUserAgent("Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0"),
    ).toEqual({ browser: "Firefox", platform: "Linux" });
  });

  it("says nothing of what it does not know, and of nothing at all", () => {
    expect(describeUserAgent("skillcdn-console/0.4.6 (cli; node 24.0.0; win32)")).toEqual({
      browser: null,
      platform: null,
    });
    expect(describeUserAgent("")).toEqual({ browser: null, platform: null });
    expect(describeUserAgent(null)).toEqual({ browser: null, platform: null });
    expect(describeUserAgent(undefined)).toEqual({ browser: null, platform: null });
    // Hostile: a string as long as a header may be, and one that is all pattern, read as text.
    expect(describeUserAgent("Chrome/".repeat(2_000))).toEqual({
      browser: "Chrome",
      platform: null,
    });
    expect(describeUserAgent("<script>Windows</script>")).toEqual({
      browser: null,
      platform: "Windows",
    });
  });
});
