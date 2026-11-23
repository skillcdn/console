// The headless browser of an agent (ADR-0149): a Google Chrome with no window, driven by a
// program that is no part of the agent's product and that the product starts beside itself, as
// a server of the Model Context Protocol. It needs no screen, no extension and no sign-in of
// its own, and keeps a profile of its own in the OS account's home, so that what the agent
// signed in at stays signed in from one session to the next. The program is looked for by the
// setup (`cli/machine-check.ts`) and named to the product by its driver; the package neither
// carries it nor fetches it.

/** The program that drives a headless Chrome: Chrome DevTools for agents, as npm installs it. */
export const HEADLESS_TOOL = {
  /** What a product calls the server, and so its tools: `mcp__chrome-devtools__<tool>` in Claude Code. */
  server: "chrome-devtools",
  command: "chrome-devtools-mcp",
  install: "npm install -g chrome-devtools-mcp",
} as const;

/**
 * The words the program is started with for a session: no window, and nothing said of the
 * agent's work to the program's maker, who is sent how its tools are used and the addresses a
 * measurement of a page's speed read unless it is started with these. A profile is named by no
 * word: the program keeps its own, the same one every time.
 */
export const HEADLESS_WORDS = [
  "--headless",
  "--no-usage-statistics",
  "--no-performance-crux",
] as const;

/**
 * How the program is started with some words, as the system the runner is on starts it. npm
 * installs a program as a script, which on Windows is a `.cmd` file that only the system's own
 * interpreter starts: there the program is started through it, with words that are the
 * package's own and never anyone else's.
 */
export function headlessToolCommand(
  platform: string | undefined,
  words: readonly string[],
): { readonly command: string; readonly args: readonly string[] } {
  return platform === "win32"
    ? { command: "cmd", args: ["/c", HEADLESS_TOOL.command, ...words] }
    : { command: HEADLESS_TOOL.command, args: [...words] };
}

/** The server a product is started with for a headless browser, in the shape a product reads its servers in. */
export function headlessServers(platform: string | undefined): {
  readonly mcpServers: Readonly<
    Record<string, { readonly command: string; readonly args: readonly string[] }>
  >;
} {
  return {
    mcpServers: { [HEADLESS_TOOL.server]: headlessToolCommand(platform, HEADLESS_WORDS) },
  };
}
