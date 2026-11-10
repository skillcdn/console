import { describe, expect, it } from "vitest";
import { LAUNCHD_LABEL, launchd, launchdUnit } from "./launchd.js";
import { ownRunnerModules } from "./modules.js";
import type { ServiceInput } from "./types.js";

// The service that keeps a runner running on macOS: what it says to write and to run. Nothing is
// written and nothing is run here, and whether the system takes the unit is seen on a Mac.

const INPUT: ServiceInput = {
  desk: "/Users/mira/desk",
  home: "/Users/mira",
  uid: 502,
  program: [
    "/usr/local/bin/node",
    "/usr/local/lib/node_modules/@skillcdn/console/dist/cli/main.js",
    "runner",
    "--url",
    "https://console.acme.example",
    "--account",
    "mira@acme.example",
  ],
  path: "/usr/local/bin:/usr/bin:/bin",
};
const UNIT = "/Users/mira/Library/LaunchAgents/ai.skillcdn.console.runner.plist";

describe("the launchd service", () => {
  it("is the package's service for macOS, and for no other platform", () => {
    const modules = ownRunnerModules({ user: "mira" });
    expect(modules.services.names()).toContain("launchd");
    expect(
      modules.services
        .names()
        .filter((name) => modules.services.get(name)?.platforms.includes("darwin") === true),
    ).toEqual(["launchd"]);
    expect(modules.services.get("launchd")?.platforms).toEqual(["darwin"]);
    expect(LAUNCHD_LABEL).toBe("ai.skillcdn.console.runner");
  });

  it("plans a launch agent of the OS account's own: a unit in its home, loaded into its own domain", () => {
    const plan = launchd.plan(INPUT);
    if ("problem" in plan) {
      throw new Error(plan.problem);
    }
    expect(plan.files.map((file) => [file.path, file.mode])).toEqual([[UNIT, 0o644]]);
    // What was loaded before is taken out first, which fails where none was; then the unit is loaded.
    expect(plan.commands).toEqual([
      {
        command: "launchctl",
        args: ["bootout", "gui/502/ai.skillcdn.console.runner"],
        mayFail: true,
      },
      { command: "launchctl", args: ["bootstrap", "gui/502", UNIT] },
    ]);
    expect(plan.log).toBe("/Users/mira/Library/Logs/ai.skillcdn.console.runner.log");
    // Nothing of it needs an administrator's rights: everything is under the account's home.
    for (const file of plan.files) {
      expect(file.path.startsWith("/Users/mira/")).toBe(true);
    }
    expect(plan.commands.map((step) => step.command)).not.toContain("sudo");
    expect(plan.failing).toContain("log in at the machine as that account");
    expect(plan.reload).toContain("next logs in");
  });

  it("writes the unit: the runner in the desk, started with the account and again when it ends", () => {
    const unit = launchdUnit(INPUT, "/Users/mira/Library/Logs/runner.log");
    expect(unit.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist ')).toBe(true);
    expect(unit.endsWith("</dict>\n</plist>\n")).toBe(true);
    expect(unit).toContain("  <key>Label</key>\n  <string>ai.skillcdn.console.runner</string>");
    expect(unit).toContain(
      [
        "  <key>ProgramArguments</key>",
        "  <array>",
        "    <string>/usr/local/bin/node</string>",
        "    <string>/usr/local/lib/node_modules/@skillcdn/console/dist/cli/main.js</string>",
        "    <string>runner</string>",
        "    <string>--url</string>",
        "    <string>https://console.acme.example</string>",
        "    <string>--account</string>",
        "    <string>mira@acme.example</string>",
        "  </array>",
      ].join("\n"),
    );
    expect(unit).toContain("  <key>WorkingDirectory</key>\n  <string>/Users/mira/desk</string>");
    expect(unit).toContain(
      "    <key>PATH</key>\n    <string>/usr/local/bin:/usr/bin:/bin</string>",
    );
    expect(unit).toContain("  <key>RunAtLoad</key>\n  <true/>");
    expect(unit).toContain("  <key>KeepAlive</key>\n  <true/>");
    expect(unit).toContain(
      "  <key>StandardOutPath</key>\n  <string>/Users/mira/Library/Logs/runner.log</string>",
    );
    expect(unit).toContain(
      "  <key>StandardErrorPath</key>\n  <string>/Users/mira/Library/Logs/runner.log</string>",
    );
    // No secret and no token is in it: the runner signs in with what the command keeps.
    expect(unit).not.toMatch(/token|secret|password/i);
    // Where nothing says where programs are, the unit says nothing of it either.
    expect(launchdUnit({ ...INPUT, path: undefined }, "x.log")).not.toContain(
      "EnvironmentVariables",
    );
  });

  it("writes what a path or a login holds as text of the unit, never as markup", () => {
    const unit = launchdUnit(
      {
        ...INPUT,
        desk: "/Users/mira/R&D <desk>",
        program: ["/bin/node", "main.js", "runner", "--account", "a&b</string><key>Evil</key>"],
      },
      "/tmp/a&b.log",
    );
    expect(unit).toContain("<string>/Users/mira/R&amp;D &lt;desk&gt;</string>");
    expect(unit).toContain("<string>a&amp;b&lt;/string&gt;&lt;key&gt;Evil&lt;/key&gt;</string>");
    expect(unit).toContain("<string>/tmp/a&amp;b.log</string>");
    expect(unit).not.toContain("<key>Evil</key>");
    expect(unit.match(/<string>/g)?.length).toBe(unit.match(/<\/string>/g)?.length);
  });

  it("says why it cannot, where the system names no number for the account or nothing starts the runner", () => {
    expect(launchd.plan({ ...INPUT, uid: undefined })).toEqual({
      problem: "the system does not say the number of this OS account",
    });
    expect(launchd.plan({ ...INPUT, program: [] })).toEqual({
      problem: "nothing says how the runner is started",
    });
  });
});
