import { describe, expect, it } from "vitest";
import { awakeWords, heldAwake, lookAtMachine, standsInTheWay } from "./machine-check.js";
import type { Ran, SetupMachine } from "./setup-machine.js";

// What a setup looks for on a machine before anyone is asked to sign in (ADR-0140), by
// platform. The setup's own tests hold what it does with the look.

function machineOf(
  platform: string,
  over: {
    readonly there?: readonly string[];
    readonly ran?: (command: string, args: readonly string[]) => Ran | undefined;
  } = {},
): { readonly machine: SetupMachine; readonly asked: string[] } {
  const asked: string[] = [];
  const home = platform === "win32" ? "C:\\Users\\mira" : "/home/mira";
  const machine: SetupMachine = {
    platform,
    user: "mira",
    home,
    uid: 1000,
    self: undefined,
    searchPath: undefined,
    path: (...parts) => parts.join(platform === "win32" ? "\\" : "/"),
    exists: async (path) => (over.there ?? []).includes(path),
    read: async () => undefined,
    holds: async () => false,
    write: async () => undefined,
    run: async (command, args) => {
      asked.push([command, ...args].join(" "));
      return over.ran?.(command, args) ?? { code: 0, out: "", err: "" };
    },
    open: async () => false,
  };
  return { machine, asked };
}

const NOT_THERE: Ran = { code: null, out: "", err: "spawn ENOENT" };

describe("the look at a machine before a setup", () => {
  it("finds git, the first product that answers, and its browser, where each system keeps them", async () => {
    const linux = machineOf("linux", {
      ran: (command) => (command === "claude" ? NOT_THERE : undefined),
    });
    expect(await lookAtMachine(linux.machine, { browser: true })).toMatchObject({
      driver: "codex",
      product: "Codex",
      // A product with no browser tool of its own asks for no browser.
      browser: undefined,
      missing: [],
    });
    expect(linux.asked).toEqual(["git --version", "claude --version", "codex --version"]);

    const windows = machineOf("win32", {
      there: ["C:\\Users\\mira\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe"],
    });
    const found = await lookAtMachine(windows.machine, { browser: true });
    expect(found).toMatchObject({ driver: "claude", browser: "chrome", missing: [] });
    expect(found.notes[0]).toContain("the Claude in Chrome extension");
  });

  it("says what installs each thing that is missing, as its system installs it", async () => {
    const windows = machineOf("win32", { ran: () => NOT_THERE });
    const none = await lookAtMachine(windows.machine, { driver: "claude", browser: true });
    expect(none.missing).toEqual([
      "git: winget install --id Git.Git -e --source winget, then a new terminal so that it is on the PATH.",
      "Claude Code: its command claude does not answer where this command looks for programs. Install it (its native installer for Windows, which puts claude.exe on the PATH) and sign it in with the agent's own subscription.",
    ]);
    // The driver asked for is the one a new desk names, found or not.
    expect(none.driver).toBe("claude");

    const linux = machineOf("linux", {
      ran: (command) => (command.startsWith("google-chrome") ? NOT_THERE : undefined),
    });
    const browserless = await lookAtMachine(linux.machine, { browser: true });
    expect(browserless.missing).toHaveLength(1);
    expect(browserless.missing[0]).toContain(
      "Google Chrome: Claude Code's browser tool works in it",
    );
    // An agent that signs in at no page is asked for none.
    expect((await lookAtMachine(linux.machine, { browser: false })).missing).toEqual([]);
    // A product the package has no driver's command for is not looked for.
    const other = await lookAtMachine(linux.machine, { driver: "acp", browser: true });
    expect(other).toMatchObject({ driver: "acp", product: undefined, missing: [] });
  });

  it("asks the system whether the runner holds it awake, where it can be asked, and says what is left to do", async () => {
    const held = machineOf("darwin", {
      ran: () => ({
        code: 0,
        out: 'pid 412(caffeinate): [0x0001] 00:00:02 PreventUserIdleSystemSleep named: "caffeinate command-line tool"\n',
        err: "",
      }),
    });
    expect(await heldAwake(held.machine)).toBe(true);
    expect(await heldAwake(machineOf("darwin").machine)).toBe(false);
    expect(await heldAwake(machineOf("linux").machine)).toBeUndefined();
    expect(awakeWords("darwin", true)).toContain("kept from sleeping while the runner runs");
    // A Mac's restart is said from its settings, read; Windows' is a sentence here.
    expect(awakeWords("darwin", true)).not.toContain("automatic login");
    expect(awakeWords("win32", true)).toContain("turn on automatic login");
    expect(awakeWords("darwin", false)).toContain(
      "The machine is not held awake by the runner: set it never to sleep when idle",
    );
    // Where the system cannot be asked, nothing is claimed: what the runner does, and where its
    // own lines say whether that holds.
    const unasked = awakeWords("linux", undefined, "the account's journal");
    expect(unasked).toContain(
      "The runner asks the system to keep the machine from sleeping while it runs, and its own lines (the account's journal) say whether that holds.",
    );
    expect(unasked).not.toContain("is kept from sleeping");
    expect(unasked).not.toContain("automatic login");
    expect(awakeWords("win32", undefined)).toContain("powercfg /change standby-timeout-ac 0");
  });

  // A Mac as its settings answer: the power settings, the disk's encryption, the account that
  // is logged in by itself and whether the system installs its own updates.
  const mac = (settings: {
    readonly sleep?: number;
    readonly autorestart?: number;
    readonly fileVault?: boolean;
    readonly autoLogin?: string;
    readonly updates?: string;
  }) =>
    machineOf("darwin", {
      ran: (command, args) => {
        if (command === "pmset") {
          return {
            code: 0,
            out: [
              "System-wide power settings:",
              "Currently in use:",
              " disksleep            10",
              ...(settings.sleep === undefined
                ? []
                : [` sleep                ${settings.sleep} (sleep prevented by caffeinate)`]),
              ...(settings.autorestart === undefined
                ? []
                : [` autorestart          ${settings.autorestart}`]),
              " displaysleep         10",
            ].join("\n"),
            err: "",
          };
        }
        if (command === "fdesetup") {
          return { code: 0, out: `FileVault is ${settings.fileVault ? "On" : "Off"}.\n`, err: "" };
        }
        const value = args.includes("autoLoginUser") ? settings.autoLogin : settings.updates;
        return value === undefined
          ? { code: 1, out: "", err: "The domain/default pair does not exist" }
          : { code: 0, out: `${value}\n`, err: "" };
      },
    }).machine;

  it("says nothing of a Mac that comes back by itself, and nothing where there is nothing to read", async () => {
    expect(
      await standsInTheWay(
        // Updates that restart the machine stop nothing where the account is logged in after.
        mac({ sleep: 0, autorestart: 1, fileVault: false, autoLogin: "mira", updates: "1" }),
      ),
    ).toEqual([]);
    const linux = machineOf("linux");
    expect(await standsInTheWay(linux.machine)).toEqual([]);
    expect(linux.asked).toEqual([]);
    // A setting that does not answer is not spoken of; a login nobody set is.
    const silent = await standsInTheWay(
      machineOf("darwin", { ran: () => ({ code: 1, out: "", err: "" }) }).machine,
    );
    expect(silent).toHaveLength(1);
    expect(silent[0]).toContain("no account is logged in by itself");
  });

  it("says each setting of a Mac that leaves the agent unheard, with what to change and its cost", async () => {
    const lines = await standsInTheWay(
      mac({ sleep: 1, autorestart: 0, fileVault: true, autoLogin: undefined, updates: "1" }),
    );
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("set to sleep after 1 idle minute.");
    expect(lines[0]).toContain("sudo pmset -a sleep 0");
    expect(lines[1]).toContain("sudo pmset -a autorestart 1");
    expect(lines[2]).toContain("FileVault is on, and with it macOS logs no account in by itself");
    expect(lines[2]).toContain("someone logs in as mira");
    expect(lines[2]).toContain("The cost: the disk is no longer encrypted");
    expect(lines[3]).toContain("macOS installs its updates by itself and restarts for them");
    expect(lines[3]).toContain("The cost: the system's fixes wait");

    // A laptop names no start after a power failure, and is not told of one.
    const plain = await standsInTheWay(mac({ sleep: 10, fileVault: false, updates: "0" }));
    expect(plain).toHaveLength(2);
    expect(plain[0]).toContain("after 10 idle minutes");
    expect(plain[1]).toContain("Turn automatic login on for mira");
    expect(plain[1]).toContain("macOS logs one account in so");
  });

  it("says whose the one automatic login is, where another account of the machine has it", async () => {
    const lines = await standsInTheWay(
      mac({ sleep: 0, autorestart: 1, fileVault: false, autoLogin: "noor", updates: "0" }),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("macOS logs one account in by itself, and here that is noor");
    expect(lines[0]).toContain("name who logs the others in after a restart");
  });
});
