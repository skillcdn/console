import { afterEach, describe, expect, it } from "vitest";
import type { RestPluginOperation } from "../plugin/rest-schemas.js";
import {
  restDecisionSchema,
  restGoalSchema,
  restRulesPluginSchema,
  restRulesSchema,
  restTaskSchema,
} from "../schemas.js";
import {
  calledOf,
  formatAgentState,
  formatDecision,
  formatDecisionLine,
  formatGoal,
  formatOperationUsage,
  formatPersonLine,
  formatPluginGrantLine,
  formatRules,
  formatRulesChanged,
  formatRulesLeftOut,
  formatTask,
  formatTaskLine,
  formatWork,
  rulesMark,
  setMomentZone,
} from "./format.js";

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

describe("the moments of a decision", () => {
  afterEach(() => {
    setMomentZone(undefined);
  });

  it("says when a decision was asked: on its line, on a person's plate and in the decision whole", () => {
    // A briefing says of each waiting decision since when it waits: the moment is on the line.
    const waiting = decision({ taskId: "0199c4d8-0000-7000-8000-000000000010", taskNumber: 7 });
    expect(formatDecisionLine(waiting)).toBe(
      `${waiting.id}  waiting  ${waiting.question}  (asked by ${AGENT} for alice, at 2026-11-06T08:00:00.000Z)`,
    );
    expect(formatDecision(waiting)).toContain(
      `asked by ${AGENT} for alice, about task #7, at 2026-11-06T08:00:00.000Z\n`,
    );
    // In the workspace's zone, as every moment the command prints, once the zone is known.
    setMomentZone("Asia/Seoul");
    expect(formatDecisionLine(waiting)).toContain("at 2026-11-06T17:00:00+09:00)");
    expect(formatDecision(waiting)).toContain("about task #7, at 2026-11-06T17:00:00+09:00\n");
    const plate = formatWork({
      tasks: [],
      decisions: [
        {
          project: { key: "web", name: "The web app", color: null, symbol: null, icon: null },
          decision: waiting,
        },
      ],
    });
    expect(plate).toContain(
      `  web  ${waiting.id}  waiting  ${waiting.question}  (asked by ${AGENT} for alice, at 2026-11-06T17:00:00+09:00)`,
    );
  });

  it("prints the moment of an answer, and of what followed, in the workspace's zone as the others are", () => {
    const answered = decision({
      answer: { option: "2", note: null, by: alice, at: "2026-11-06T09:00:00.000Z", agent: AGENT },
      outcome: "Done.",
      outcomeBy: alice,
      outcomeAgent: null,
      outcomeAt: "2026-11-06T10:00:00.000Z",
    });
    setMomentZone("Asia/Seoul");
    const text = formatDecision(answered);
    expect(text).toContain(
      `Answered: 2) That, by alice through ${AGENT} at 2026-11-06T18:00:00+09:00`,
    );
    expect(text).toContain("written by alice at 2026-11-06T19:00:00+09:00");
    expect(text).not.toContain("T09:00:00.000Z");
    expect(text).not.toContain("T10:00:00.000Z");
  });
});

describe("the rules as they are printed (ADR-0119, ADR-0120)", () => {
  const CONSOLE = "# Rules for agents on this board\n\nRead these.";
  const ADDED = "Ask alice before a release.";
  const OWN = "# Rules of this project\n\nAsk before pushing.";
  const page = (updatedAt = "2026-11-06T08:00:00.000Z") => ({
    id: "0199c4d8-0000-7000-8000-000000000080",
    path: "rules",
    title: "Rules",
    version: 2,
    updatedBy: alice,
    agent: null,
    archivedAt: null,
    createdAt: "2026-11-06T08:00:00.000Z",
    updatedAt,
  });
  /** The workspace's half where the organization adds nothing: the console's rules alone. */
  const alone = restRulesSchema.parse({
    source: "reference",
    body: CONSOLE,
    page: null,
    own: CONSOLE,
    added: null,
  });
  /** The workspace's half where it adds something: the whole in `body`, the parts apart. */
  const adding = (added = ADDED) =>
    restRulesSchema.parse({
      source: "written",
      body: `${CONSOLE}\n\n# What this organization adds\n\n${added}`,
      page: page(),
      own: CONSOLE,
      added: { body: added, page: page() },
    });
  const none = restRulesSchema.parse({ source: "none", body: null, page: null });
  const written = (body: string, updatedAt?: string) =>
    restRulesSchema.parse({ source: "written", body, page: page(updatedAt) });
  const own = written(OWN);
  const plugin = restRulesPluginSchema.parse({
    key: "hr",
    name: { en: "HR", ko: "인사" },
    description: { en: "Leave and notices.", ko: "휴가와 공지." },
    agentNote: { en: "Ask leave here.", ko: "휴가는 여기서." },
    roles: ["member"],
  });
  const laterTake = (mark: string) =>
    ` A later take in this session leaves them out: console take <number> --rules ${mark}`;

  it("begins with a line that says which parts follow and how long each is: what differs first, what always holds last", () => {
    const rules = { workspace: adding(), project: own, plugins: [plugin] };
    const mark = rulesMark(rules, "en");
    expect(mark).toMatch(/^[0-9a-f]{8}$/);
    const text = formatRules(rules, "en");
    expect(text.split("\n")[0]).toBe(
      `Rules ${mark}: this project's additions first (${OWN.length} characters) with its 1 plugin, then the organization's (${ADDED.length} characters), then the console's (${CONSOLE.length} characters), the earlier holding where they differ.${laterTake(mark)}`,
    );
    // The project's additions and the plugins' lines stand first, then what the organization
    // adds, then the console's rules: an agent that cuts the print at its head still reads
    // what differs, and what always holds is what it has read before.
    const at = (words: string) => text.indexOf(words);
    expect(at("What this project adds (v2, by alice; ")).toBeGreaterThan(0);
    expect(at("Ask before pushing.")).toBeLessThan(at("## Plugins"));
    expect(at("- hr (HR): Ask leave here. Start with console plugin hr.")).toBeLessThan(
      at("What this organization adds (v2, by alice; "),
    );
    expect(at("What this organization adds (v2, by alice; ")).toBeLessThan(at(ADDED));
    expect(at(ADDED)).toBeLessThan(at("The console's rules, which always hold:"));
    expect(at("The console's rules, which always hold:")).toBeLessThan(at("Read these."));
    // Each part once: the whole the console answers beside them is not printed again.
    expect(text.split(ADDED)).toHaveLength(2);
    expect(text.split("Read these.")).toHaveLength(2);
    expect(text).not.toContain("# What this organization adds");
  });

  it("says in a clause of that line who adds nothing, and that no project is named", () => {
    // A project that adds, in an organization that adds nothing.
    const projects = { workspace: alone, project: own };
    expect(formatRules(projects, "en").split("\n")[0]).toBe(
      `Rules ${rulesMark(projects, "en")}: this project's additions first (${OWN.length} characters), then the console's (${CONSOLE.length} characters), the earlier holding where they differ; the organization adds nothing.${laterTake(rulesMark(projects, "en"))}`,
    );
    // A project that adds nothing, in an organization that adds.
    const organizations = { workspace: adding(), project: none };
    const theirs = formatRules(organizations, "en");
    expect(theirs.split("\n")[0]).toBe(
      `Rules ${rulesMark(organizations, "en")}: this project adds nothing; the organization's additions first (${ADDED.length} characters), then the console's (${CONSOLE.length} characters), the earlier holding where they differ.${laterTake(rulesMark(organizations, "en"))}`,
    );
    expect(theirs).not.toContain("What this project adds");
    // Neither adds: the console's rules alone, said once, on the first line.
    const bare = { workspace: alone, project: none };
    const mark = rulesMark(bare, "en");
    const text = formatRules(bare, "en");
    expect(text.split("\n")[0]).toBe(
      `Rules ${mark}: this project and the organization add nothing; the console's follow (${CONSOLE.length} characters).${laterTake(mark)}`,
    );
    expect(text).not.toContain("What this project adds");
    expect(text).not.toContain("What this organization adds");
    const withPlugins = formatRules({ workspace: alone, project: none, plugins: [plugin] }, "en");
    expect(withPlugins.split("\n")[0]).toContain(
      `: this project and the organization add nothing; its 1 plugin first, then the console's (${CONSOLE.length} characters). A later take`,
    );
    expect(withPlugins.indexOf("## Plugins")).toBeLessThan(withPlugins.indexOf("Read these."));
    // No project named: the organization's additions and the console's; the same mark as a
    // project that adds nothing has.
    expect(formatRules(alone, "en").split("\n")[0]).toBe(
      `Rules ${mark}: the organization adds nothing; the console's follow (${CONSOLE.length} characters); no project is named here, and a project's additions stand before them where it has some.`,
    );
    expect(rulesMark(alone, "en")).toBe(mark);
    expect(formatRules(adding(), "en").split("\n")[0]).toBe(
      `Rules ${rulesMark(adding(), "en")}: the organization's additions first (${ADDED.length} characters), then the console's (${CONSOLE.length} characters), the earlier holding where they differ; no project is named here, and a project's additions stand before them where it has some.`,
    );
  });

  it("marks the rules as they read for whoever reads them: the same for the same, another for another", () => {
    const rules = { workspace: adding(), project: own, plugins: [plugin] };
    const mark = rulesMark(rules, "en");
    // The same rules, read again: the same mark, whatever else of the answer moved.
    expect(rulesMark({ ...rules, project: written(OWN, "2026-11-07T08:00:00.000Z") }, "en")).toBe(
      mark,
    );
    // A rule changed: in what the project adds, in what the organization adds, in the console's.
    expect(rulesMark({ ...rules, project: written(`${OWN} Twice.`) }, "en")).not.toBe(mark);
    expect(rulesMark({ ...rules, workspace: adding(`${ADDED} Always.`) }, "en")).not.toBe(mark);
    expect(rulesMark({ ...rules, workspace: alone }, "en")).not.toBe(mark);
    expect(
      rulesMark(
        {
          ...rules,
          workspace: {
            ...adding(),
            body: adding().body?.replace("Read these.", "Read all.") ?? "",
          },
        },
        "en",
      ),
    ).not.toBe(mark);
    // Another project's rules: none of its own, or other plugins.
    expect(rulesMark({ ...rules, project: none }, "en")).not.toBe(mark);
    expect(rulesMark({ workspace: adding(), project: own }, "en")).not.toBe(mark);
    // Another language: the plugins' lines are read in it, and so are the rules.
    expect(rulesMark(rules, "ko")).not.toBe(mark);
  });

  it("says in a line that the rules were left out, or that they changed since the mark given", () => {
    expect(formatRulesLeftOut("3f9a1c2e")).toBe(
      "Rules 3f9a1c2e: left out, since they stand as this session read them. console rules prints them.",
    );
    expect(formatRulesChanged("0a1b2c3d")).toBe(
      "The rules are not the ones marked 0a1b2c3d: they changed since, or that mark is of another project's. They follow whole after the task, under the mark they have now.",
    );
  });
});

describe("a grant in a line", () => {
  it("names whom a role went to: a team by its key, never as everyone (ADR-0074)", () => {
    const grant = {
      id: "0199c4d8-0000-7000-8000-000000000090",
      role: "approver",
      person: null,
      project: null,
      everyone: false,
      plugin: null,
      team: { key: "platform", name: "Platform" },
      createdAt: "2026-11-02T01:00:00.000Z",
    };
    expect(formatPluginGrantLine(grant)).toContain("approver to the team platform");
    expect(formatPluginGrantLine({ ...grant, team: null, everyone: true })).toContain(
      "approver to everyone",
    );
  });
});

describe("a member's line", () => {
  const person = {
    id: "0199c4d8-0000-7000-8000-000000000001",
    login: "carol",
    name: "Carol",
    avatar: null,
    role: "member",
    status: "active",
    source: "listed",
    deactivatedAt: null,
  } as const;

  it("says a person as it always did, and what they do where a title says", () => {
    expect(formatPersonLine(person)).toBe("carol  Carol  (member)");
    expect(formatPersonLine({ ...person, name: null })).toBe("carol  (member)");
    expect(formatPersonLine({ ...person, title: "Designer" }, "alice")).toBe(
      "carol  Carol, Designer  (member, reports to alice)",
    );
    expect(formatPersonLine({ ...person, status: "deactivated" })).toBe(
      "carol  Carol  (member, deactivated)",
    );
  });

  it("says an agent account by its handle too, that it is one, and that nobody signed in with it yet (ADR-0084)", () => {
    const mira = { ...person, name: "Mira", kind: "agent", handle: "mira" } as const;
    expect(formatPersonLine({ ...mira, title: "Release engineer", invited: true }, "alice")).toBe(
      "carol @mira  Mira, Release engineer  (agent account, member, not signed in yet, reports to alice)",
    );
    expect(formatPersonLine(mira)).toBe("carol @mira  Mira  (agent account, member)");
  });

  it("calls an agent account by its handle where a line names who has a task, and a person by their login (ADR-0084)", () => {
    // A task with a person and an agent account at work on it reads as both: `@mira` is what
    // the command takes for the account wherever it takes a login.
    const mira = { ...person, name: "Mira", kind: "agent", handle: "mira" } as const;
    expect(calledOf(person)).toBe("carol");
    expect(calledOf(mira)).toBe("@mira");
    expect(calledOf({ login: "dave", handle: null })).toBe("dave");
    const shared = task({ owner: mira, workers: [alice, mira] });
    expect(formatTaskLine(shared)).toBe(
      "#7  ready  normal  Fix the parser  (owner @mira; workers alice, @mira)",
    );
    expect(formatTask(shared)).toContain("owner: @mira  workers: alice, @mira");
  });
});

describe("how an agent account stands, in a line", () => {
  const mira = {
    person: {
      id: "0199c4d8-0000-7000-8000-000000000009",
      login: "acme-mira",
      name: "Mira",
      avatar: null,
      role: "member",
      status: "active",
      source: "listed",
      deactivatedAt: null,
      kind: "agent",
      handle: "mira",
    },
    manager: null,
    supervised: true,
  } as const;
  const SINCE = "2026-11-23T08:41:00.000Z";
  const HEARD = "2026-11-25T14:20:00.000Z";

  it("says since when the state stands, and the reason apart from it with its own moment", () => {
    // A reason said later, under a state that stayed: its moment is its own, and the moment
    // after `since` stays the state's.
    expect(
      formatAgentState({
        ...mira,
        state: {
          state: "running",
          reason: "reset",
          since: SINCE,
          reasonAt: "2026-11-25T14:12:00.000Z",
          heardAt: HEARD,
        },
      }),
    ).toBe(
      `running since ${SINCE}; why: reset, said 2026-11-25T14:12:00.000Z; its runner was last heard from ${HEARD}`,
    );
  });

  it("says a reason that came with its state, or that the console keeps no moment for, with none", () => {
    // With the state, a few seconds apart by two machines' clocks: one moment, the state's.
    expect(
      formatAgentState({
        ...mira,
        state: {
          state: "failed",
          reason: "usage_limit",
          since: SINCE,
          reasonAt: "2026-11-23T08:41:03.000Z",
          heardAt: null,
          until: "2026-11-23T13:00:00.000Z",
        },
      }),
    ).toBe(`failed since ${SINCE}, until 2026-11-23T13:00:00.000Z; why: usage limit`);
    // A row of before, and an answer of a console of before: never the state's moment as the
    // reason's.
    for (const reasonAt of [null, undefined]) {
      expect(
        formatAgentState({
          ...mira,
          state: { state: "running", reason: "reset", since: SINCE, reasonAt, heardAt: HEARD },
        }),
      ).toBe(`running since ${SINCE}; why: reset; its runner was last heard from ${HEARD}`);
    }
    expect(
      formatAgentState({
        ...mira,
        state: { state: "running", reason: null, since: SINCE, heardAt: null },
      }),
    ).toBe(`running since ${SINCE}`);
    expect(formatAgentState(mira)).toBe("no runner has been heard from yet");
  });
});
