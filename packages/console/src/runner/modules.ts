import { createClaudeDriver } from "./claude.js";
import { launchd } from "./launchd.js";
import { createRunnerModules, type RunnerModules } from "./registry.js";
import { slack } from "./slack.js";

/**
 * The modules the package ships (ADR-0085): the `claude` driver; `console`, the console's own
 * stream of signals, which every runner listens to, and `slack`, which raises a wake for what
 * is said to the agent at that messenger; `launchd`, the service that keeps a runner
 * running on macOS; and `os-user`, the boundary that keeps one agent apart from another by the
 * OS account each runs in.
 */
export function ownRunnerModules(machine: { readonly user: string }): RunnerModules {
  const modules = createRunnerModules();
  modules.drivers.register("claude", createClaudeDriver);
  modules.wakeSources.register("console", { name: "console" });
  modules.wakeSources.register("slack", slack);
  modules.services.register("launchd", launchd);
  modules.boundaries.register("os-user", { name: "os-user", user: () => machine.user });
  return modules;
}
