import { describe, expect, it } from "vitest";
import { agentLabel } from "./agent-name.js";

describe("an agent's name", () => {
  it("is said before where it runs, and whole when it names no place", () => {
    expect(agentLabel("Claude Code on a laptop")).toBe("Claude Code");
    expect(agentLabel("Codex on DESKTOP-1")).toBe("Codex");
    expect(agentLabel("Claude Code")).toBe("Claude Code");
    expect(agentLabel("a script")).toBe("a script");
    expect(agentLabel("Working on it")).toBe("Working");
    expect(agentLabel(" on ")).toBe(" on ");
    expect(agentLabel("Claude Code on ")).toBe("Claude Code on ");
  });
});
