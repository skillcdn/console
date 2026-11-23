import type { SetupMachine } from "./setup-machine.js";

// What `console agent setup` looks for on a machine before it asks anyone to sign in (ADR-0140):
// git, the command of the agent's product, and the browser that product's browser tool works
// in. Everything that is missing is found in one look and said at once, with what installs it,
// so that the session that was given the line installs it all and runs the line again, and a
// person is asked to sign in once, on a machine that is ready. What the setup cannot see, a
// product's sign-in and a browser's extension, it says in a line and does not hold up for.

/** A product the package has a driver for, as a setup looks for it on a machine. */
interface Product {
  readonly driver: string;
  readonly name: string;
  readonly command: string;
  /** What installs it for an OS account, by platform; `any` where one line does everywhere. */
  readonly install: Readonly<Record<string, string>>;
  /** The browser its own browser tool works in, and what that browser needs for it. */
  readonly browser?: { readonly name: "chrome"; readonly needs: string } | undefined;
}

const PRODUCTS: readonly Product[] = [
  {
    driver: "claude",
    name: "Claude Code",
    command: "claude",
    install: {
      any: "npm install -g @anthropic-ai/claude-code",
      // The runner starts a program, and npm makes a script of it there.
      win32: "its native installer for Windows, which puts claude.exe on the PATH",
    },
    browser: { name: "chrome", needs: "the Claude in Chrome extension" },
  },
  {
    driver: "codex",
    name: "Codex",
    command: "codex",
    install: {
      any: "npm install -g @openai/codex",
      win32: "a build of it for Windows that is a program on the PATH",
    },
  },
];

/** What a look at a machine found. */
export interface MachineLook {
  /** The driver of the product found, or the one asked for; nothing where none was found. */
  readonly driver: string | undefined;
  /** What the product is called and the version it says, where it answered. */
  readonly product: string | undefined;
  /** The browser the product's browser tool works in, where the product has such a tool and the browser is there. */
  readonly browser: "chrome" | undefined;
  /** What is missing, a line each, with what installs it: the setup stops for any of these. */
  readonly missing: readonly string[];
  /** What the setup could not see and says once: it goes on. */
  readonly notes: readonly string[];
}

const answers = async (
  machine: SetupMachine,
  command: string,
  args: readonly string[],
): Promise<string | undefined> => {
  const ran = await machine.run(command, args);
  return ran.code === 0 ? ran.out.trim().split(/\r?\n/)[0]?.trim() || "" : undefined;
};

/** What installs git for an OS account, by platform, in words a session acts on. */
function gitMissing(platform: string): string {
  switch (platform) {
    case "darwin":
      return "git: the Command Line Tools are not installed, so git is a placeholder that opens a window. Install them: xcode-select --install, then Install in the window it opens on the machine's screen, pressed by whoever sees that screen.";
    case "win32":
      return "git: winget install --id Git.Git -e --source winget, then a new terminal so that it is on the PATH.";
    default:
      return "git: install it with the system's package manager, which takes an administrator (sudo apt-get install -y git, or the like).";
  }
}

/** Whether Google Chrome is on the machine, looked for where each system keeps it. */
async function chromeThere(machine: SetupMachine): Promise<boolean> {
  if (machine.platform === "darwin") {
    return (
      (await machine.exists("/Applications/Google Chrome.app")) ||
      (await machine.exists(machine.path(machine.home, "Applications", "Google Chrome.app")))
    );
  }
  if (machine.platform === "win32") {
    for (const place of [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      machine.path(
        machine.home,
        "AppData",
        "Local",
        "Google",
        "Chrome",
        "Application",
        "chrome.exe",
      ),
    ]) {
      if (await machine.exists(place)) {
        return true;
      }
    }
    return false;
  }
  for (const command of ["google-chrome", "google-chrome-stable"]) {
    if ((await answers(machine, command, ["--version"])) !== undefined) {
      return true;
    }
  }
  return false;
}

/**
 * Looks at the machine: git, the product, its browser. `driver` names the product where whoever
 * runs the setup said one, and the first of the package's products that answers is taken where
 * they said none; `browser: false` is an agent that signs in at no page.
 */
export async function lookAtMachine(
  machine: SetupMachine,
  wanted: { readonly driver?: string | undefined; readonly browser: boolean },
): Promise<MachineLook> {
  const missing: string[] = [];
  const notes: string[] = [];

  // On a Mac without the Command Line Tools, git is there and opens a window instead of
  // answering: asked for only once the tools are known to be installed.
  const tools =
    machine.platform !== "darwin" || (await answers(machine, "xcode-select", ["-p"])) !== undefined;
  if (!tools || (await answers(machine, "git", ["--version"])) === undefined) {
    missing.push(gitMissing(machine.platform));
  }

  const install = (product: Product): string =>
    product.install[machine.platform] ?? product.install.any ?? "as its maker says";
  let found: { readonly product: Product; readonly version: string } | undefined;
  const candidates =
    wanted.driver === undefined
      ? PRODUCTS
      : PRODUCTS.filter((product) => product.driver === wanted.driver);
  for (const product of candidates) {
    const version = await answers(machine, product.command, ["--version"]);
    if (version !== undefined) {
      found = { product, version };
      break;
    }
  }
  if (found === undefined && candidates.length > 0) {
    missing.push(
      candidates.length === 1 && candidates[0] !== undefined
        ? `${candidates[0].name}: its command ${candidates[0].command} does not answer where this command looks for programs. Install it (${install(candidates[0])}) and sign it in with the agent's own subscription.`
        : `the agent's product: none of ${candidates.map((product) => `${product.command} (${product.name})`).join(", ")} answers where this command looks for programs. Install the one the agent runs in (${candidates.map((product) => `${product.name}: ${install(product)}`).join("; ")}) and sign it in with the agent's own subscription. For another product, say --driver acp and name its command in the desk's runner.json.`,
    );
  }

  let browser: "chrome" | undefined;
  const tool = found?.product.browser;
  if (tool !== undefined && wanted.browser) {
    if (await chromeThere(machine)) {
      browser = tool.name;
      notes.push(
        `Google Chrome is there. ${found?.product.name}'s browser tool also takes ${tool.needs} in it, signed in as the agent's subscription account: install it now where it is not there.`,
      );
    } else {
      missing.push(
        `Google Chrome: ${found?.product.name}'s browser tool works in it, and the agent signs in at its services with that tool. Install it, and ${tool.needs} in it. For an agent that signs in at no page, say --no-browser.`,
      );
    }
  }
  if (found !== undefined) {
    notes.push(
      `Whether ${found.product.name} is signed in cannot be seen from here: where it is not, the agent's page says so once its first session starts.`,
    );
  }
  return {
    driver: found?.product.driver ?? wanted.driver,
    product:
      found === undefined
        ? undefined
        : `${found.product.name}${found.version.length === 0 ? "" : ` (${found.version})`}`,
    browser,
    missing,
    notes,
  };
}

/**
 * Whether the machine is held awake by the runner's own helper, as the system says where it
 * can be asked without an administrator: yes, no, or nothing where it cannot be asked.
 */
export async function heldAwake(machine: SetupMachine): Promise<boolean | undefined> {
  if (machine.platform !== "darwin") {
    return undefined;
  }
  const ran = await machine.run("pmset", ["-g", "assertions"]);
  return ran.code === 0 ? /\(caffeinate\)/.test(ran.out) : undefined;
}

/**
 * What a setup says of sleep, a sentence by platform: that the machine is held awake where the
 * system said so, that it is not where it said that, and where it cannot be asked, what the
 * runner does and where it says whether that holds; then what is left to whoever keeps the
 * machine. `log` is where the runner's own lines are. Of a Mac's restart it says nothing: its
 * settings are read, and `standsInTheWay` says what they leave to do.
 */
export function awakeWords(platform: string, held: boolean | undefined, log?: string): string {
  const back =
    platform === "win32"
      ? " After a restart the runner starts when this OS account is logged in: turn on automatic login for it where the machine is to come back by itself."
      : "";
  if (held === false) {
    return `The machine is not held awake by the runner: set it never to sleep when idle (System Settings, Energy; or sudo pmset -a sleep 0, which takes an administrator), or the agent is not heard from once it sleeps.${back}`;
  }
  if (held === true) {
    return `The machine is kept from sleeping while the runner runs; a sleep someone asks for, or a lid that is closed, still ends that.${back}`;
  }
  const where = log === undefined ? "its own lines" : `its own lines (${log})`;
  const otherwise =
    platform === "win32"
      ? " Where they say it is not, or the machine sleeps all the same: powercfg /change standby-timeout-ac 0."
      : " Where they say it is not, turn sleeping when idle off in the system's power settings.";
  return `The runner asks the system to keep the machine from sleeping while it runs, and ${where} say whether that holds.${otherwise}${back}`;
}

/** A setting of the system as a program prints it, trimmed; nothing where it did not answer. */
const setting = async (
  machine: SetupMachine,
  command: string,
  args: readonly string[],
): Promise<string | undefined> => {
  const ran = await machine.run(command, args);
  return ran.code === 0 ? ran.out.trim() : undefined;
};

/**
 * The settings of a Mac that leave an agent unheard once nobody is at the machine, a line each
 * with what to change and what the change costs, for whoever keeps the machine: a sleep when
 * idle, a power failure it does not start after, and a restart, an update's own among them,
 * that the OS account is not logged in after. Each is read as any account may read it; one
 * that does not answer is not spoken of, and nothing is changed. Elsewhere there is nothing to
 * read: a Linux account's service starts with the machine, and `awakeWords` says Windows' part.
 */
export async function standsInTheWay(machine: SetupMachine): Promise<readonly string[]> {
  if (machine.platform !== "darwin") {
    return [];
  }
  const lines: string[] = [];
  const power = (await setting(machine, "pmset", ["-g"])) ?? "";
  const minutes = /^\s*sleep\s+(\d+)/m.exec(power)?.[1];
  if (minutes !== undefined && minutes !== "0") {
    lines.push(
      `Sleep: the machine is set to sleep after ${minutes} idle ${minutes === "1" ? "minute" : "minutes"}. The runner holds that off only while it runs, and a machine that did fall asleep stays asleep until someone wakes it. Set it never to sleep: sudo pmset -a sleep 0, which takes an administrator, or System Settings, Energy. The cost is the power of a machine that is always on; the display still sleeps.`,
    );
  }
  if (/^\s*autorestart\s+0\b/m.test(power)) {
    lines.push(
      "A power failure: the machine stays off when the power comes back. Have it start by itself: sudo pmset -a autorestart 1, or System Settings, Energy. It costs nothing but that the machine starts with nobody there.",
    );
  }

  // A launch agent runs while its account is logged in, and macOS logs one account in by
  // itself, and none while the disk is encrypted.
  const encrypted = /FileVault is On/i.test((await setting(machine, "fdesetup", ["status"])) ?? "");
  const auto =
    (await setting(machine, "defaults", [
      "read",
      "/Library/Preferences/com.apple.loginwindow",
      "autoLoginUser",
    ])) ?? "";
  const back = auto === machine.user;
  if (encrypted) {
    lines.push(
      `A restart: FileVault is on, and with it macOS logs no account in by itself, so after every restart the runner waits until someone logs in as ${machine.user} at the machine. To come back by itself the machine gives FileVault up (sudo fdesetup disable) and logs ${machine.user} in automatically (System Settings, Users & Groups; an administrator). The cost: the disk is no longer encrypted, so whoever takes the machine or its disk reads all of it, the agent's sign-ins among it. Keep FileVault where that weighs more, and name who logs in after a restart.`,
    );
  } else if (!back) {
    lines.push(
      auto.length === 0
        ? `A restart: no account is logged in by itself, so after every restart the runner waits until someone logs in as ${machine.user} at the machine. Turn automatic login on for ${machine.user} (System Settings, Users & Groups; an administrator). The cost: whoever starts the machine is in that account without its password. macOS logs one account in so: where several agents share the machine, choose which, and name who logs the others in after a restart.`
        : `A restart: macOS logs one account in by itself, and here that is ${auto}, so after every restart the runner of ${machine.user} waits until someone logs in as ${machine.user} at the machine. Choose which account the machine logs in by itself, and name who logs the others in after a restart.`,
    );
  }
  const updates = await setting(machine, "defaults", [
    "read",
    "/Library/Preferences/com.apple.SoftwareUpdate",
    "AutomaticallyInstallMacOSUpdates",
  ]);
  if (!back && (updates === "1" || updates?.toLowerCase() === "true")) {
    lines.push(
      "Updates: macOS installs its updates by itself and restarts for them, at night as a rule, which leaves the agent unheard until someone logs in. Turn that off (System Settings, General, Software Update, Automatic Updates: Install macOS updates) where nobody is there to log in. The cost: the system's fixes wait until a person installs them, so someone has to.",
    );
  }
  return lines;
}
