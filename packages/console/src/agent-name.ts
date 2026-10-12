// What an agent is called: what it said of itself when it connected, which the person approving
// kept or changed, and what a run was told with `--agent`. The command proposes "<agent> on
// <machine>", so the pages say the agent and keep the machine for a hover.

/** The agent's name before where it runs: "Claude Code" of "Claude Code on a laptop"; the whole name when it names no place. */
export function agentLabel(name: string): string {
  const at = name.indexOf(" on ");
  return at > 0 && at + 4 < name.length ? name.slice(0, at) : name;
}
