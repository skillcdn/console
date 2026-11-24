import { describe, expect, it } from "vitest";
import { HEADLESS_TOOL, HEADLESS_WORDS, headlessServers, headlessToolCommand } from "./browser.js";

// The program that drives an agent's headless browser (ADR-0151): how it is started on each
// system, and what a product is handed to start it with.

describe("the program that drives a headless Chrome", () => {
  it("is started as it is installed, and through the system's interpreter on Windows", () => {
    for (const platform of ["darwin", "linux", undefined]) {
      expect(headlessToolCommand(platform, ["--version"])).toEqual({
        command: "chrome-devtools-mcp",
        args: ["--version"],
      });
    }
    // npm installs it as a `.cmd` file there, which no program starts by its name alone.
    expect(headlessToolCommand("win32", ["--version"])).toEqual({
      command: "cmd",
      args: ["/c", "chrome-devtools-mcp", "--version"],
    });
  });

  it("is handed to a product as one server, with no window and nothing sent to its maker", () => {
    expect(headlessServers("linux")).toEqual({
      mcpServers: {
        "chrome-devtools": {
          command: "chrome-devtools-mcp",
          args: ["--headless", "--no-usage-statistics", "--no-performance-crux"],
        },
      },
    });
    expect(headlessServers("win32").mcpServers[HEADLESS_TOOL.server]).toEqual({
      command: "cmd",
      args: ["/c", "chrome-devtools-mcp", ...HEADLESS_WORDS],
    });
    // The profile is the program's own, the same one every time: a word that named a new one
    // for a session would have every service take the agent for a stranger.
    expect(HEADLESS_WORDS.join(" ")).not.toMatch(/isolated|user-data-dir/i);
  });
});
