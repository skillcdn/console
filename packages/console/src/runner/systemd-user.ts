import type { Service, ServiceCommand, ServiceInput } from "./types.js";

// The service that keeps a runner running on Linux (ADR-0085): a unit of the agent's own OS
// account, kept by that account's own instance of systemd. It needs no administrator's rights.
// That instance is there while the account has a session, or always where lingering is on for
// the account, which also starts it with the machine: the account turns lingering on for
// itself where the system lets it, as Ubuntu does, and an administrator does where it does not.
// Written from the system's own documentation, systemd.unit(5), systemd.service(5),
// systemctl(1) and loginctl(1), and run on Ubuntu 24.04 with systemd 255; the module says what
// to write and what to run, and whoever sets the machine up does it.

/** What the unit is called: one runner for an OS account, which is one agent's. */
export const SYSTEMD_UNIT = "skillcdn-console-runner.service";

/** How long the account's systemd is given to be there once lingering was asked for: tries, a second apart. */
const TRIES_AFTER_LINGER = 10;

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
    // The account's own systemd is reached through the folder the system keeps for the account,
    // which a shell entered from another account (`sudo -iu`) is not told of.
    const env = input.uid === undefined ? undefined : { XDG_RUNTIME_DIR: `/run/user/${input.uid}` };
    const own = (...args: readonly string[]): ServiceCommand => ({
      command: "systemctl",
      args: ["--user", ...args],
      ...(env === undefined ? {} : { env }),
    });
    return {
      files: [{ path: unit, text: systemdUnit(input), mode: 0o644 }],
      commands: [
        // Lingering first: it starts the account's systemd where the account has no session,
        // and the system answers before that systemd is there, so the command after it is
        // tried for a while.
        ...(input.uid === undefined
          ? []
          : [
              {
                command: "loginctl",
                args: ["enable-linger", String(input.uid)],
                mayFail: true,
                otherwise: `Lingering was not turned on for this OS account, so the runner runs while the account has a session and no longer, and does not start with the machine: have an administrator run loginctl enable-linger ${input.uid}.`,
              },
            ]),
        // The unit is read anew, turned on for the account's sessions to come, and started
        // now: started again where it ran already, with what was written.
        { ...own("daemon-reload"), tries: TRIES_AFTER_LINGER },
        own("enable", SYSTEMD_UNIT),
        own("restart", SYSTEMD_UNIT),
      ],
      // A unit written again is not read until the account's systemd is told to: telling it
      // ends nothing that runs.
      reread: [own("daemon-reload")],
      log: `the account's journal (journalctl --user -u ${SYSTEMD_UNIT})`,
      failing:
        "A unit of an OS account is kept by that account's own systemd, which is there while the account has a session, or always once lingering is on for it: log in as that account, or have an administrator turn lingering on for it (loginctl enable-linger), and run this again.",
      reload: "when the service is next started.",
    };
  },
};
