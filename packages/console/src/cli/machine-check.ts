import { HEADLESS_TOOL, headlessToolCommand } from "../runner/browser.js";
import type { RunnerBrowser } from "../runner/config.js";
import type { SetupMachine } from "./setup-machine.js";

// What `console agent setup` looks for on a machine before it asks anyone to sign in (ADR-0140):
// git, the command of the agent's product, and the agent's browser, which is a Chrome with no
// window and the program that drives it unless whoever runs the setup names the product's own
// browser tool (ADR-0149). Everything that is missing is found in one look and said at once,
// with what installs it, so that the session that was given the line installs it all and runs
// the line again, and a person is asked to sign in once, on a machine that is ready. What the
// setup cannot see, a product's sign-in and a browser's extension, it says in a line and does
// not hold up for.

/** A product the package has a driver for, as a setup looks for it on a machine. */
interface Product {
  readonly driver: string;
  readonly name: string;
  readonly command: string;
  /** What installs it for an OS account, by platform; `any` where one line does everywhere. */
  readonly install: Readonly<Record<string, string>>;
  /**
   * The browsers its driver starts it with, by the names `runner.json` takes (ADR-0149):
   * `headless` asks nothing of the product, and `chrome` is the product's own browser tool,
   * with what that tool needs in the browser. Left out, its driver starts it with none.
   */
  readonly browsers?:
    | { readonly headless?: true; readonly chrome?: { readonly needs: string } }
    | undefined;
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
    browsers: { headless: true, chrome: { needs: "the Claude in Chrome extension" } },
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
  /**
   * The agent's browser, as a new desk names it: the one asked for, where the product is
   * started with it and it is there, and `none` where none was asked for. Nothing where the
   * product is started with none, or none was found: the desk then names what a `runner.json`
   * that says nothing means.
   */
  readonly browser: RunnerBrowser | undefined;
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

/**
 * Whether Google Chrome is on the machine, looked for where each system keeps it. `by` says
 * who starts it. A person, or a product's tool in a browser that is open, takes it wherever it
 * is. The program that starts one with no window looks in the system's own place and nowhere
 * else: a copy in the OS account's own Applications on a Mac, or a command of its name on
 * Linux that is not its maker's package, is none that program finds.
 */
async function chromeThere(machine: SetupMachine, by: "person" | "program"): Promise<boolean> {
  if (machine.platform === "darwin") {
    return (
      (await machine.exists("/Applications/Google Chrome.app")) ||
      (by === "person" &&
        (await machine.exists(machine.path(machine.home, "Applications", "Google Chrome.app"))))
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
  if (by === "program") {
    return machine.exists("/opt/google/chrome/chrome");
  }
  for (const command of ["google-chrome", "google-chrome-stable"]) {
    if ((await answers(machine, command, ["--version"])) !== undefined) {
      return true;
    }
  }
  return false;
}

/** Where Google Chrome is put for the program that starts it with no window, in a few words for a line that asks for it. */
function chromePlace(platform: string): string {
  switch (platform) {
    case "darwin":
      return " in /Applications, where the program that starts it looks";
    case "linux":
      return " from its maker's package (google-chrome-stable), which takes an administrator";
    default:
      return "";
  }
}

/**
 * Looks at the machine: git, the product, its browser. `driver` names the product where whoever
 * runs the setup said one, and the first of the package's products that answers is taken where
 * they said none; `browser` is the browser asked for, `headless` where whoever runs the setup
 * said none, and `none` for an agent that signs in at no page.
 */
export async function lookAtMachine(
  machine: SetupMachine,
  wanted: { readonly driver?: string | undefined; readonly browser: RunnerBrowser },
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

  let browser: RunnerBrowser | undefined = wanted.browser === "none" ? "none" : undefined;
  if (found !== undefined && wanted.browser !== "none") {
    const { name, browsers } = found.product;
    const tool = browsers?.chrome;
    if (wanted.browser === "headless" && browsers?.headless === true) {
      // Nothing of it is the product's or a person's: the browser and the program that drives
      // it are both seen from here, and there is no extension and no sign-in to say a line of.
      const chrome = await chromeThere(machine, "program");
      const program = headlessToolCommand(machine.platform, ["--version"]);
      const drives = (await answers(machine, program.command, program.args)) !== undefined;
      if (!chrome) {
        missing.push(
          `Google Chrome: the agent's browser is a Chrome with no window, which ${name} is started with, and the agent signs in at its services in it. Install it${chromePlace(machine.platform)}. For an agent that signs in at no page, say --no-browser.`,
        );
      }
      if (!drives) {
        missing.push(
          `${HEADLESS_TOOL.command}: the program that drives a Chrome with no window for ${name}. Install it: ${HEADLESS_TOOL.install}.${tool === undefined ? "" : ` For ${name}'s own browser tool instead, in a Chrome with a window and ${tool.needs}, say --browser chrome.`}`,
        );
      }
      if (chrome && drives) {
        browser = "headless";
      }
    } else if (wanted.browser === "chrome" && tool !== undefined) {
      if (await chromeThere(machine, "person")) {
        browser = "chrome";
        notes.push(
          `Google Chrome is there. ${name}'s browser tool also takes ${tool.needs} in it, signed in as the agent's subscription account: install it now where it is not there.`,
        );
      } else {
        missing.push(
          `Google Chrome: ${name}'s browser tool works in it, and the agent signs in at its services with that tool. Install it, and ${tool.needs} in it. For an agent that signs in at no page, say --no-browser.`,
        );
      }
    } else {
      notes.push(
        `No browser for ${name}: its driver starts it with none${browsers === undefined ? "" : ` of the kind ${wanted.browser}`}, whatever the desk's runner.json names.`,
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
 * machine. `log` is where the runner's own lines are.
 */
export function awakeWords(platform: string, held: boolean | undefined, log?: string): string {
  const back =
    platform === "linux"
      ? ""
      : " After a restart the runner starts when this OS account is logged in: turn on automatic login for it where the machine is to come back by itself.";
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
