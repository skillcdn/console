// Where the command runs from, so that the update it is told to make is the one that takes
// effect: installed for the machine, in a project, run once from a cache, or a checkout of the
// repository. Read from the package's own path and the working directory; nothing is asked of
// the system, so that a notice about versions costs a command nothing.

export type InstallKind = "global" | "project" | "temporary" | "checkout";
export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export interface Install {
  readonly kind: InstallKind;
  readonly manager: PackageManager;
  /** The directory the package is installed in: a project's root, the machine's global one, a cache's; the checkout itself. */
  readonly root: string;
}

export interface InstallClues {
  /** The package's own directory, where its manifest is. */
  readonly packageDir: string;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly exists: (path: string) => boolean;
}

const PACKAGE = "@skillcdn/console";

const slashes = (path: string): string => path.replaceAll("\\", "/").replace(/\/+$/, "");

/** The package manager that ran this command, when one did: `pnpm exec`, `npx` and their kind say so. */
function managerRunning(env: InstallClues["env"]): PackageManager | undefined {
  const agent = env.npm_config_user_agent ?? "";
  for (const manager of ["pnpm", "yarn", "bun", "npm"] as const) {
    if (agent.startsWith(`${manager}/`)) {
      return manager;
    }
  }
  return undefined;
}

export function detectInstall(clues: InstallClues): Install {
  const dir = slashes(clues.packageDir);
  const cwd = slashes(clues.cwd);
  const at = dir.indexOf("/node_modules/");
  if (at < 0) {
    return { kind: "checkout", manager: "pnpm", root: dir };
  }
  const root = dir.slice(0, at);
  const lower = dir.toLowerCase();
  const running = managerRunning(clues.env);
  // What `npx`, `pnpm dlx`, `yarn dlx` and `bunx` fetch into a cache lives only for the run.
  if (/\/(_npx|dlx|dlx-[^/]*)\//.test(lower) || lower.includes("/.bun/install/cache/")) {
    const manager =
      running ??
      (lower.includes("/_npx/") ? "npm" : lower.includes("/.bun/install/cache/") ? "bun" : "pnpm");
    return { kind: "temporary", manager, root };
  }
  if (cwd === root || cwd.startsWith(`${root}/`)) {
    const manager: PackageManager = clues.exists(`${root}/pnpm-lock.yaml`)
      ? "pnpm"
      : clues.exists(`${root}/yarn.lock`)
        ? "yarn"
        : clues.exists(`${root}/bun.lock`) || clues.exists(`${root}/bun.lockb`)
          ? "bun"
          : (running ?? "npm");
    return { kind: "project", manager, root };
  }
  const manager: PackageManager = /\/pnpm\/global\/|\/\.pnpm-global\//.test(lower)
    ? "pnpm"
    : lower.includes("/yarn/global/")
      ? "yarn"
      : lower.includes("/.bun/install/global/")
        ? "bun"
        : "npm";
  return { kind: "global", manager, root };
}

/** The command that puts the version named where this command is installed. */
export function updateCommandFor(install: Install, version: string): string {
  const spec = `${PACKAGE}@${version}`;
  switch (install.kind) {
    case "global":
      return install.manager === "npm"
        ? `npm install -g ${spec}`
        : install.manager === "yarn"
          ? `yarn global add ${spec}`
          : `${install.manager} add -g ${spec}`;
    case "project":
      return `${install.manager === "npm" ? "npm install" : `${install.manager} add`} ${spec}`;
    case "temporary":
      return install.manager === "npm"
        ? `npx ${spec}`
        : install.manager === "bun"
          ? `bunx ${spec}`
          : `${install.manager} dlx ${spec}`;
    case "checkout":
      return "git pull && pnpm install && pnpm build";
  }
}

/** Where the command is installed, in words: what `whoami` and `--version` say. */
export function describeInstall(install: Install): string {
  switch (install.kind) {
    case "global":
      return `installed for the machine with ${install.manager} in ${install.root}`;
    case "project":
      return `installed in the project at ${install.root} with ${install.manager}`;
    case "temporary":
      return `fetched for this run by ${install.manager}`;
    case "checkout":
      return `built from the checkout at ${install.root}`;
  }
}
