import { describe, expect, it } from "vitest";
import type { RestPluginOperation } from "../plugin/rest-schemas.js";
import { restDecisionSchema, restGoalSchema, restTaskSchema } from "../schemas.js";
import { formatDecision, formatGoal, formatOperationUsage, formatTask } from "./format.js";

describe("the usage of a plugin's command", () => {
  const argument = (extra: Record<string, unknown>) => ({
    type: "text",
    optional: false,
    positional: false,
    ...extra,
  });
  const announce: RestPluginOperation = {
    name: "announcement",
    kind: "command",
    about: "Writes an announcement.",
    args: {
      title: argument({ positional: true }),
      body: argument({ type: "markdown" }),
      pin: argument({ type: "boolean", optional: true }),
      picture: argument({ type: "file", optional: true }),
      tags: argument({ type: "list", optional: true, of: argument({}) }),
    } as RestPluginOperation["args"],
    roles: null,
  };

  it("is whole in help, a file as --file <path>, which the command takes, not a flag of the argument's name", () => {
    expect(formatOperationUsage("hr", announce)).toBe(
      "console plugin hr announcement <title> --body <markdown> [--pin] [--file <path>] [--tags <text,...>]",
    );
  });

  it("is brief in the listing: the positionals, the required flags, and [options] for the rest", () => {
    expect(formatOperationUsage("hr", announce, { brief: true })).toBe(
      "console plugin hr announcement <title> --body <markdown> [options]",
    );
    // Nothing to fold: no [options].
    expect(
      formatOperationUsage(
        "hr",
        { ...announce, args: { title: argument({ positional: true }) } } as RestPluginOperation,
        { brief: true },
      ),
    ).toBe("console plugin hr announcement <title>");
  });
});

const alice = {
  id: "0199c4d8-0000-7000-8000-000000000001",
  login: "alice",
  name: "Alice Example",
  avatar: null,
  role: "member",
  status: "active",
  source: "organization",
  deactivatedAt: null,
};

const AGENT = "Claude Code on the laptop";

const decision = (overrides: Record<string, unknown> = {}) =>
  restDecisionSchema.parse({
    id: "0199c4d8-0000-7000-8000-000000000020",
    question: "Which?",
    body: "",
    options: [
      { id: "1", label: "This" },
      { id: "2", label: "That" },
    ],
    taskId: null,
    taskNumber: null,
    raisedBy: alice,
    decider: alice,
    run: { id: "0199c4d8-0000-7000-8000-000000000040", agent: AGENT },
    plugin: null,
    answer: null,
    outcome: null,
    files: [],
    createdAt: "2026-11-06T08:00:00.000Z",
    updatedAt: "2026-11-06T10:00:00.000Z",
    ...overrides,
  });

const task = (overrides: Record<string, unknown> = {}) =>
  restTaskSchema.parse({
    id: "0199c4d8-0000-7000-8000-000000000010",
    number: 7,
    title: "Fix the parser",
    body: "",
    state: "ready",
    priority: "normal",
    owner: alice,
    plugin: null,
    workers: [],
    parentId: null,
    category: null,
    goalId: null,
    startsOn: null,
    dueOn: null,
    startedAt: null,
    doneAt: null,
    archivedAt: null,
    links: [],
    openDecisions: 0,
    openRuns: 0,
    createdAt: "2026-11-06T08:00:00.000Z",
    updatedAt: "2026-11-06T08:00:00.000Z",
    ...overrides,
  });

const goal = (overrides: Record<string, unknown> = {}) =>
  restGoalSchema.parse({
    id: "0199c4d8-0000-7000-8000-000000000030",
    title: "Ship v1",
    body: "",
    state: "planned",
    category: null,
    startsOn: null,
    dueOn: null,
    createdBy: alice,
    taskCounts: { idea: 0, ready: 0, in_progress: 0, in_review: 0, done: 0, dropped: 0 },
    createdAt: "2026-11-06T08:00:00.000Z",
    updatedAt: "2026-11-06T08:00:00.000Z",
    ...overrides,
  });

// A record that names the person who did a thing names the agent they did it through
// (ADR-0056): the command prints it beside the login, and nothing when they did it themselves.
describe("the agent beside the person", () => {
  it("is printed on an answer and on what followed, when they came through one", () => {
    const text = formatDecision(
      decision({
        answer: {
          option: "2",
          note: null,
          by: alice,
          at: "2026-11-06T09:00:00.000Z",
          agent: AGENT,
        },
        outcome: "Done.",
        outcomeBy: alice,
        outcomeAgent: "Codex on the desk",
        outcomeAt: "2026-11-06T10:00:00.000Z",
      }),
    );
    expect(text).toContain(
      `Answered: 2) That, by alice through ${AGENT} at 2026-11-06T09:00:00.000Z`,
    );
    expect(text).toContain(
      "written by alice through Codex on the desk at 2026-11-06T10:00:00.000Z",
    );
  });

  it("is left out when the person answered and wrote themselves, and read from an older console", () => {
    const themselves = formatDecision(
      decision({
        answer: {
          option: "1",
          note: "Sure.",
          by: alice,
          at: "2026-11-06T09:00:00.000Z",
          agent: null,
        },
        outcome: "Done.",
        outcomeBy: alice,
        outcomeAgent: null,
        outcomeAt: "2026-11-06T10:00:00.000Z",
      }),
    );
    expect(themselves).toContain("Answered: 1) This, by alice at 2026-11-06T09:00:00.000Z");
    expect(themselves).toContain("written by alice at 2026-11-06T10:00:00.000Z");
    expect(themselves).not.toContain("through");
    // An older console answers neither the agent nor who wrote what followed.
    const older = formatDecision(
      decision({
        answer: { option: "1", note: null, by: alice, at: "2026-11-06T09:00:00.000Z" },
        outcome: "Done.",
      }),
    );
    expect(older).toContain("Answered: 1) This, by alice at 2026-11-06T09:00:00.000Z");
    expect(older).toContain("what followed:");
    expect(older).not.toContain("written by");
  });

  it("is printed on a task written through an agent and on a goal set through one", () => {
    expect(formatTask(task({ agent: AGENT }))).toContain(`written through: ${AGENT}`);
    expect(formatTask(task({ agent: null }))).not.toContain("written through");
    expect(formatTask(task())).not.toContain("written through");
    expect(formatGoal(goal({ agent: "Codex on the desk" }))).toContain(
      "set by: alice through Codex on the desk",
    );
    expect(formatGoal(goal({ agent: null }))).toContain("set by: alice\n");
    expect(formatGoal(goal())).not.toContain("through");
  });
});
