import { describe, expect, it } from "vitest";
import {
  CLIENT_POLICY,
  CONSOLE_AT_LEAST,
  clientRange,
  clientVersionOf,
  commonRange,
  compareVersions,
  consoleRange,
  formatRange,
  formatVersion,
  inRange,
  judgeClient,
  judgeConsole,
  parseRange,
  parseVersion,
  userAgentOf,
} from "./compat.js";

const v = (text: string) => {
  const parsed = parseVersion(text);
  if (parsed === undefined) {
    throw new Error(`not a version: ${text}`);
  }
  return parsed;
};

describe("versions", () => {
  it("parses x.y.z and nothing else", () => {
    expect(parseVersion("0.1.18")).toEqual({ major: 0, minor: 1, patch: 18 });
    expect(formatVersion(v("12.345.6789"))).toBe("12.345.6789");
    for (const bad of [
      "",
      "1",
      "1.2",
      "1.2.3.4",
      "01.2.3",
      "1.2.3-beta.1",
      "1.2.3+build",
      "v1.2.3",
      " 1.2.3",
      "1234567890.0.0",
      "1.2.3".padEnd(40, "0"),
      "x.y.z",
    ]) {
      expect(parseVersion(bad), bad).toBeUndefined();
    }
    expect(parseVersion(undefined)).toBeUndefined();
    expect(parseVersion(null)).toBeUndefined();
  });

  it("orders by major, then minor, then patch", () => {
    expect(compareVersions(v("0.1.18"), v("0.1.18"))).toBe(0);
    expect(compareVersions(v("0.1.9"), v("0.1.18"))).toBeLessThan(0);
    expect(compareVersions(v("0.2.0"), v("0.1.18"))).toBeGreaterThan(0);
    expect(compareVersions(v("1.0.0"), v("0.9.9"))).toBeGreaterThan(0);
  });

  it("spells and reads a range as npm does", () => {
    const range = { atLeast: v("0.1.18"), below: v("0.2.0") };
    expect(formatRange(range)).toBe(">=0.1.18 <0.2.0");
    expect(parseRange(">=0.1.18 <0.2.0")).toEqual(range);
    expect(inRange(v("0.1.18"), range)).toBe(true);
    expect(inRange(v("0.1.99"), range)).toBe(true);
    expect(inRange(v("0.1.17"), range)).toBe(false);
    expect(inRange(v("0.2.0"), range)).toBe(false);
    for (const bad of ["", "^0.1.18", ">=0.1.18", ">=0.2.0 <0.1.0", ">=a <b", ">=0.1.18  <0.2.0"]) {
      expect(parseRange(bad), bad).toBeUndefined();
    }
  });
});

describe("the common rule", () => {
  it("before 1.0 takes the console's version on, within its minor", () => {
    expect(formatRange(commonRange(v("0.1.18")))).toBe(">=0.1.0 <0.2.0");
    expect(formatRange(commonRange(v("0.0.0")))).toBe(">=0.0.0 <0.1.0");
  });

  it("from 1.0 takes the console's major and a minor within one, either way", () => {
    expect(formatRange(commonRange(v("1.4.2")))).toBe(">=1.3.0 <1.6.0");
    expect(formatRange(commonRange(v("1.0.0")))).toBe(">=1.0.0 <1.2.0");
    expect(formatRange(commonRange(v("2.0.5")))).toBe(">=2.0.0 <2.2.0");
  });

  it("is narrowed by the policy's floor only where the floor is within it", () => {
    expect(CLIENT_POLICY).toEqual({ atLeast: "0.3.2" });
    expect(CONSOLE_AT_LEAST).toBe("0.3.2");
    expect(formatRange(clientRange(v("1.4.2"), { atLeast: "1.4.1" }))).toBe(">=1.4.1 <1.6.0");
    expect(formatRange(clientRange(v("1.4.2"), { atLeast: "1.2.0" }))).toBe(">=1.3.0 <1.6.0");
    expect(formatRange(clientRange(v("1.4.2"), { atLeast: "1.6.0" }))).toBe(">=1.3.0 <1.6.0");
    expect(formatRange(clientRange(v("1.4.2"), { atLeast: "nonsense" }))).toBe(">=1.3.0 <1.6.0");
    expect(formatRange(clientRange(v("0.1.18"), { atLeast: "0.1.20" }))).toBe(">=0.1.20 <0.2.0");
    expect(formatRange(clientRange(v("0.1.18"), { atLeast: "0.0.5" }))).toBe(">=0.1.0 <0.2.0");
  });
});

describe("judging a command", () => {
  it("before 1.0 takes the console's line, and refuses another minor (ADR-0038)", () => {
    const server = v("0.1.18");
    expect(judgeClient(v("0.1.18"), server).verdict).toBe("current");
    expect(judgeClient(v("0.1.19"), server).verdict).toBe("ahead");
    expect(judgeClient(v("0.1.17"), server).verdict).toBe("behind");
    expect(judgeClient(v("0.1.0"), server).verdict).toBe("behind");
    expect(judgeClient(v("0.2.0"), server).verdict).toBe("too_new");
    expect(judgeClient(v("0.0.9"), server).verdict).toBe("outdated");
    expect(judgeClient(v("1.0.0"), server).verdict).toBe("too_new");
    expect(formatRange(judgeClient(v("0.1.17"), server).range)).toBe(">=0.1.0 <0.2.0");
    // The floor of the console's policy, where it is within the line.
    expect(judgeClient(v("0.3.1"), v("0.3.4")).verdict).toBe("outdated");
    expect(judgeClient(v("0.3.2"), v("0.3.4")).verdict).toBe("behind");
  });

  it("from 1.0 answers a minor within one and refuses the rest", () => {
    const server = v("1.4.2");
    expect(judgeClient(v("1.4.2"), server).verdict).toBe("current");
    expect(judgeClient(v("1.4.0"), server).verdict).toBe("behind");
    expect(judgeClient(v("1.3.9"), server).verdict).toBe("behind");
    expect(judgeClient(v("1.5.0"), server).verdict).toBe("ahead");
    expect(judgeClient(v("1.2.99"), server).verdict).toBe("outdated");
    expect(judgeClient(v("1.6.0"), server).verdict).toBe("too_new");
    expect(judgeClient(v("2.0.0"), server).verdict).toBe("too_new");
    expect(judgeClient(v("0.9.0"), v("1.0.0")).verdict).toBe("outdated");
  });

  it("refuses what the policy refuses, and takes its floor", () => {
    const policy = { atLeast: "1.4.1", refused: ["1.4.1", "1.5.3", "garbage"] };
    expect(judgeClient(v("1.4.0"), v("1.4.2"), policy).verdict).toBe("outdated");
    expect(judgeClient(v("1.4.1"), v("1.4.2"), policy).verdict).toBe("outdated");
    expect(judgeClient(v("1.5.3"), v("1.4.2"), policy).verdict).toBe("too_new");
    expect(judgeClient(v("1.5.2"), v("1.4.2"), policy).verdict).toBe("ahead");
  });
});

describe("judging a console (ADR-0038)", () => {
  it("works with the command's line from the command's floor on, and refuses an older console itself", () => {
    const command = v("0.3.5");
    expect(judgeConsole(v("0.3.5"), command, "0.3.2").verdict).toBe("current");
    expect(judgeConsole(v("0.3.2"), command, "0.3.2").verdict).toBe("behind");
    expect(judgeConsole(v("0.3.9"), command, "0.3.2").verdict).toBe("ahead");
    expect(judgeConsole(v("0.3.1"), command, "0.3.2").verdict).toBe("outdated");
    expect(judgeConsole(v("0.2.9"), command, "0.3.2").verdict).toBe("outdated");
    expect(judgeConsole(v("0.4.0"), command, "0.3.2").verdict).toBe("too_new");
    expect(formatRange(consoleRange(command, "0.3.2"))).toBe(">=0.3.2 <0.4.0");
    // A floor outside the line is no floor; from 1.0 the line is a minor either way.
    expect(formatRange(consoleRange(command, "0.2.0"))).toBe(">=0.3.0 <0.4.0");
    expect(judgeConsole(v("1.3.0"), v("1.4.2"), "1.0.0").verdict).toBe("behind");
    expect(judgeConsole(v("1.6.0"), v("1.4.2"), "1.0.0").verdict).toBe("too_new");
    expect(judgeConsole(v("1.2.0"), v("1.4.2"), "1.0.0").verdict).toBe("outdated");
  });
});

describe("the user-agent", () => {
  it("names the command and where it runs, and reads it back", () => {
    expect(userAgentOf("0.1.18")).toBe("skillcdn-console/0.1.18");
    expect(userAgentOf("0.1.18", "cli; node 24.11.0; win32")).toBe(
      "skillcdn-console/0.1.18 (cli; node 24.11.0; win32)",
    );
    expect(clientVersionOf(userAgentOf("0.1.18", "cli; node 24.11.0; win32"))).toEqual(v("0.1.18"));
    expect(clientVersionOf("Mozilla/5.0 skillcdn-console/0.1.18 other/1")).toEqual(v("0.1.18"));
  });

  it("keeps a comment to what a comment may hold", () => {
    expect(userAgentOf("0.1.18", "a (b) \\ c\u0000\n")).toBe("skillcdn-console/0.1.18 (a b  c)");
    expect(userAgentOf("0.1.18", "   ")).toBe("skillcdn-console/0.1.18");
  });

  it("reads nothing from any other client, or from a token that is not a version", () => {
    for (const other of [
      undefined,
      null,
      "",
      "node",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "skillcdn-console/latest",
      "skillcdn-console/0.1",
      "skillcdn-console/0.1.18.1",
      "skillcdn-console/0.1.18-beta",
      "notskillcdn-console/0.1.18",
      "skillcdn-console/1234567890.0.0",
      `${"x".repeat(600)} skillcdn-console/0.1.18`,
    ]) {
      expect(clientVersionOf(other), String(other)).toBeUndefined();
    }
  });
});
