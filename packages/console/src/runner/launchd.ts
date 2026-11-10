import type { Service, ServiceInput } from "./types.js";

// The service that keeps a runner running on macOS (ADR-0085): a launch agent of the agent's
// own OS account, loaded into that account's own domain. It needs no administrator's rights,
// and so it runs while the account is logged in at the machine: that the account is logged in
// when the machine starts is for whoever prepares the machine. Written from the system's own
// documentation, launchd.plist(5) and launchctl(1); the module says what to write and what to
// run, and whoever sets the machine up does it.

/** What the unit is called: one runner for an OS account, which is one agent's. */
export const LAUNCHD_LABEL = "ai.skillcdn.console.runner";

/** A text inside the unit's XML. */
const escaped = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const string = (text: string, indent: string): string =>
  `${indent}<string>${escaped(text)}</string>`;

/** The unit: the runner started in the desk when the account logs in, and again whenever it ends. */
export function launchdUnit(input: ServiceInput, log: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    string(LAUNCHD_LABEL, "  "),
    "  <key>ProgramArguments</key>",
    "  <array>",
    ...input.program.map((word) => string(word, "    ")),
    "  </array>",
    "  <key>WorkingDirectory</key>",
    string(input.desk, "  "),
    // A unit starts with the system's few folders to look in: the product, and what the agent
    // runs, are found where they were when the machine was set up.
    ...(input.path === undefined
      ? []
      : [
          "  <key>EnvironmentVariables</key>",
          "  <dict>",
          "    <key>PATH</key>",
          string(input.path, "    "),
          "  </dict>",
        ]),
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <true/>",
    "  <key>StandardOutPath</key>",
    string(log, "  "),
    "  <key>StandardErrorPath</key>",
    string(log, "  "),
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

export const launchd: Service = {
  name: "launchd",
  platforms: ["darwin"],
  plan(input) {
    if (input.uid === undefined) {
      return { problem: "the system does not say the number of this OS account" };
    }
    if (input.program.length === 0) {
      return { problem: "nothing says how the runner is started" };
    }
    const unit = `${input.home}/Library/LaunchAgents/${LAUNCHD_LABEL}.plist`;
    const log = `${input.home}/Library/Logs/${LAUNCHD_LABEL}.log`;
    const domain = `gui/${input.uid}`;
    return {
      files: [{ path: unit, text: launchdUnit(input, log), mode: 0o644 }],
      commands: [
        // A unit is read when it is loaded and never again: the one loaded before is taken out
        // first, which fails where none was.
        { command: "launchctl", args: ["bootout", `${domain}/${LAUNCHD_LABEL}`], mayFail: true },
        { command: "launchctl", args: ["bootstrap", domain, unit] },
      ],
      log,
      failing:
        "A launch agent is loaded into the login session of its OS account: log in at the machine as that account, and have the machine log it in when it starts.",
      reload: "when the OS account next logs in, or the machine starts again.",
    };
  },
};
