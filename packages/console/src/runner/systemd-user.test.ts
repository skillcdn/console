import { describe, expect, it } from "vitest";
import { ownRunnerModules } from "./modules.js";
import { SYSTEMD_UNIT, systemdUnit, systemdUser } from "./systemd-user.js";
import type { ServiceInput } from "./types.js";

// The service that keeps a runner running on Linux: what it says to write and to run. Nothing
// is written and nothing is run here, and whether the system takes the unit is seen on a machine.

const INPUT: ServiceInput = {
  desk: "/home/mira/desk",
  home: "/home/mira",
  uid: 1001,
  program: [
    "/usr/bin/node",
    "/usr/lib/node_modules/@skillcdn/console/dist/cli/main.js",
    "runner",
    "--url",
    "https://console.acme.example",
    "--account",
    "mira@acme.example",
  ],
  path: "/usr/local/bin:/usr/bin:/bin",
};
const UNIT = "/home/mira/.config/systemd/user/skillcdn-console-runner.service";

describe("the systemd-user service", () => {
  it("is the package's service for Linux, beside the one for macOS", () => {
    const modules = ownRunnerModules({ user: "mira" });
    expect(modules.services.names()).toEqual(["launchd", "systemd-user"]);
    expect(modules.services.get("systemd-user")?.platforms).toEqual(["linux"]);
    expect(SYSTEMD_UNIT).toBe("skillcdn-console-runner.service");
  });

  it("plans a unit of the OS account's own: written in its home, turned on and started by its own systemd", () => {
    const plan = systemdUser.plan(INPUT);
    if ("problem" in plan) {
      throw new Error(plan.problem);
    }
    expect(plan.files.map((file) => [file.path, file.mode])).toEqual([[UNIT, 0o644]]);
    expect(plan.commands).toEqual([
      { command: "systemctl", args: ["--user", "daemon-reload"] },
      { command: "systemctl", args: ["--user", "enable", "skillcdn-console-runner.service"] },
      { command: "systemctl", args: ["--user", "restart", "skillcdn-console-runner.service"] },
    ]);
    // Nothing of it needs an administrator's rights: everything is the account's own.
    expect(
      plan.commands.every((step) => step.command === "systemctl" && step.args[0] === "--user"),
    ).toBe(true);
    expect(plan.files.every((file) => file.path.startsWith("/home/mira/"))).toBe(true);
    expect(plan.log).toContain("journalctl --user -u skillcdn-console-runner.service");
    expect(plan.failing).toContain("loginctl enable-linger");
    expect(plan.reload).toBe("when the service is next started.");
    // The system has no number to ask for here: a unit is written whatever the account's is.
    expect("problem" in systemdUser.plan({ ...INPUT, uid: undefined })).toBe(false);
    expect(systemdUser.plan({ ...INPUT, program: [] })).toEqual({
      problem: "nothing says how the runner is started",
    });
  });

  it("writes the unit: the runner in the desk, started with the account's session and again when it ends", () => {
    expect(systemdUnit(INPUT).split("\n")).toEqual([
      "[Unit]",
      "Description=The runner of an agent account of the SkillCDN Console",
      "After=network-online.target",
      "Wants=network-online.target",
      "",
      "[Service]",
      "Type=simple",
      "WorkingDirectory=/home/mira/desk",
      'ExecStart="/usr/bin/node" "/usr/lib/node_modules/@skillcdn/console/dist/cli/main.js" "runner" "--url" "https://console.acme.example" "--account" "mira@acme.example"',
      'Environment="PATH=/usr/local/bin:/usr/bin:/bin"',
      "Restart=always",
      "RestartSec=10",
      "",
      "[Install]",
      "WantedBy=default.target",
      "",
    ]);
    // No secret and no token is in it: the runner signs in with what the command keeps.
    expect(systemdUnit(INPUT)).not.toMatch(/token|secret|password/i);
    expect(systemdUnit({ ...INPUT, path: undefined })).not.toContain("Environment=");
  });

  it("writes what a path or a login holds as words of the unit: one line, quoted, and no specifier or variable of the system's", () => {
    const backslash = String.fromCodePoint(92);
    const unit = systemdUnit({
      ...INPUT,
      desk: "/home/mira/my desk 100%",
      program: [
        "/usr/bin/node",
        "main.js",
        "runner",
        "--account",
        `a "b" $HOME %h ${backslash}n\nExecStartPost=/bin/rm -rf /`,
      ],
      path: "/opt/my tools/bin:$HOME/bin",
    });
    const lines = unit.split("\n");
    expect(lines).toContain("WorkingDirectory=/home/mira/my desk 100%%");
    // One line of ExecStart, whatever the word holds: nothing in it begins a line of the unit.
    expect(lines.filter((line) => line.startsWith("ExecStart"))).toHaveLength(1);
    expect(lines.some((line) => line.startsWith("ExecStartPost"))).toBe(false);
    const start = lines.find((line) => line.startsWith("ExecStart=")) ?? "";
    expect(start).toContain(
      `"a ${backslash}"b${backslash}" $$HOME %%h ${backslash}${backslash}n ExecStartPost=/bin/rm -rf /"`,
    );
    expect(lines).toContain('Environment="PATH=/opt/my tools/bin:$$HOME/bin"');
  });
});
