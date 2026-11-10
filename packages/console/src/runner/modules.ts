import { createClaudeDriver } from "./claude.js";
import { createRunnerModules, type RunnerModules } from "./registry.js";

/**
 * The modules the package ships (ADR-0085): the `claude` driver; `console`, the console's own
 * stream of signals, which every runner listens to; and `os-user`, the boundary that keeps one
 * agent apart from another by the OS account each runs in. The service that keeps a runner
 * running is registered by what sets a machine up.
 */
export function ownRunnerModules(machine: { readonly user: string }): RunnerModules {
  const modules = createRunnerModules();
  modules.drivers.register("claude", createClaudeDriver);
  modules.wakeSources.register("console", { name: "console" });
  modules.boundaries.register("os-user", { name: "os-user", user: () => machine.user });
  return modules;
}
