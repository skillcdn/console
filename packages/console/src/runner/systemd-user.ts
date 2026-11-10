import type { Service, ServiceInput } from "./types.js";

// The service that keeps a runner running on Linux (ADR-0085): a unit of the agent's own OS
// account, kept by that account's own instance of systemd. It needs no administrator's rights,
// and so it runs while the account has a session, or always where lingering is turned on for
// the account, which is an administrator's to do and for whoever prepares the machine. Written
// from the system's own documentation, systemd.unit(5), systemd.service(5) and systemctl(1);
// the module says what to write and what to run, and whoever sets the machine up does it.

/** What the unit is called: one runner for an OS account, which is one agent's. */
export const SYSTEMD_UNIT = "skillcdn-console-runner.service";

/** A value of the unit on one line, with what the system would read as a specifier or a variable said as itself. */
const plain = (text: string): string =>
  text
    .replaceAll(/[\r\n]+/g, " ")
    .replaceAll("%", "%%")
    .replaceAll("$", "$$$$");

/** A word of a command line as the unit quotes one: whole, whatever spaces and quotes it holds. */
const word = (text: string): string =>
  `"${plain(text).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

/** The unit: the runner started in the desk with the account's session, and again whenever it ends. */
export function systemdUnit(input: ServiceInput): string {
  return [
    "[Unit]",
    "Description=The runner of an agent account of the SkillCDN Console",
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    `WorkingDirectory=${plain(input.desk)}`,
    `ExecStart=${input.program.map(word).join(" ")}`,
    // The product, and what the agent runs, are found where they were when the machine was set up.
    ...(input.path === undefined ? [] : [`Environment=${word(`PATH=${input.path}`)}`]),
    "Restart=always",
    "RestartSec=10",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

export const systemdUser: Service = {
  name: "systemd-user",
  platforms: ["linux"],
  plan(input) {
    if (input.program.length === 0) {
      return { problem: "nothing says how the runner is started" };
    }
    const unit = `${input.home}/.config/systemd/user/${SYSTEMD_UNIT}`;
    return {
      files: [{ path: unit, text: systemdUnit(input), mode: 0o644 }],
      commands: [
        // The unit is read anew, turned on for the account's sessions to come, and started
        // now: started again where it ran already, with what was written.
        { command: "systemctl", args: ["--user", "daemon-reload"] },
        { command: "systemctl", args: ["--user", "enable", SYSTEMD_UNIT] },
        { command: "systemctl", args: ["--user", "restart", SYSTEMD_UNIT] },
      ],
      log: `the account's journal (journalctl --user -u ${SYSTEMD_UNIT})`,
      failing:
        "A unit of an OS account is kept by that account's own systemd, which is there while the account has a session: log in as that account, or have an administrator turn lingering on for it (loginctl enable-linger), which also starts it with the machine.",
      reload: "when the service is next started.",
    };
  },
};
