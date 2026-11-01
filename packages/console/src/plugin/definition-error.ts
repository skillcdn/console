/**
 * What `definePlugin` and its definers throw when a definition is not one the console can hold: a
 * name that is not a key, a command named as a subcommand, more of something than the bound. It
 * is thrown when the server module loads, so that a plugin's own tests and `console-plugin check`
 * meet it before any console does; `problems` names every one found.
 */
export class PluginDefinitionError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(
      problems.length === 1
        ? `the plugin's definition is invalid: ${problems[0]}`
        : `the plugin's definition is invalid:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`,
    );
    this.name = "PluginDefinitionError";
    this.problems = problems;
  }
}
