import { describe, expect, it } from "vitest";
import {
  MAX_BODY_LENGTH,
  MAX_LINKS,
  MAX_OPTIONS,
  MAX_TITLE_LENGTH,
  MAX_TOKEN_DAYS,
  MAX_TOKEN_NAME_LENGTH,
} from "./limits.js";
import {
  restAnswerInputSchema,
  restDecisionInputSchema,
  restEventSchema,
  restPersonPatchSchema,
  restPersonSchema,
  restTaskInputSchema,
  restTaskPatchSchema,
  restTaskSchema,
  restTokenCreatedSchema,
  restTokenInputSchema,
  restTokenSchema,
  restTokensSchema,
} from "./schemas.js";

const PERSON = {
  id: "0199c4d8-0000-7000-8000-000000000001",
  login: "alice",
  name: "Alice Example",
  avatar: "https://avatars.example/alice.png",
  role: "member" as const,
};

describe("task input", () => {
  it("takes a title alone, trimmed, and the rest with defaults", () => {
    const parsed = restTaskInputSchema.parse({ title: "  Write the release notes  " });
    expect(parsed).toEqual({ title: "Write the release notes" });
  });

  it("takes everything a task has", () => {
    const parsed = restTaskInputSchema.parse({
      title: "Ship",
      body: "# Plan\n\n- step one\n- step two\n",
      state: "ready",
      priority: "high",
      assigneeId: PERSON.id,
      parentId: null,
      links: [{ url: "https://github.com/acme/app/pull/1", label: "the pull request" }],
    });
    expect(parsed.links).toEqual([
      { url: "https://github.com/acme/app/pull/1", label: "the pull request" },
    ]);
    expect(parsed.parentId).toBeNull();
  });

  it.each([
    ["an empty title", { title: "   " }],
    ["a title over the limit", { title: "t".repeat(MAX_TITLE_LENGTH + 1) }],
    ["a title with a line break", { title: "one\ntwo" }],
    ["a title with a hidden character", { title: `one${String.fromCodePoint(0x200b)}two` }],
    ["a title with a direction override", { title: `one${String.fromCodePoint(0x202e)}two` }],
    ["a body over the limit", { title: "t", body: "b".repeat(MAX_BODY_LENGTH + 1) }],
    ["a body with a NUL", { title: "t", body: `a${String.fromCodePoint(0)}b` }],
    ["a state that is not one", { title: "t", state: "started" }],
    ["a priority that is not one", { title: "t", priority: "p0" }],
    ["an assignee that is not an id", { title: "t", assigneeId: "alice" }],
    ["a link that is not https", { title: "t", links: [{ url: "http://example.com/" }] }],
    ["a link that runs", { title: "t", links: [{ url: "javascript:alert(1)" }] }],
    ["too many links", { title: "t", links: Array(MAX_LINKS + 1).fill({ url: "https://a.b/" }) }],
    ["a number for a title", { title: 42 }],
    ["an array for a body", { title: "t", body: ["x"] }],
    ["nothing", undefined],
  ])("refuses %s", (_, input) => {
    expect(restTaskInputSchema.safeParse(input).success).toBe(false);
  });

  it("keeps a body's line breaks and tabs", () => {
    const parsed = restTaskInputSchema.parse({ title: "t", body: "a\n\tb\r\nc" });
    expect(parsed.body).toBe("a\n\tb\r\nc");
  });

  it("takes a patch of nothing, and of one field", () => {
    expect(restTaskPatchSchema.parse({})).toEqual({});
    expect(restTaskPatchSchema.parse({ state: "done" })).toEqual({ state: "done" });
    expect(restTaskPatchSchema.safeParse({ title: "" }).success).toBe(false);
  });
});

describe("decision input", () => {
  it("wants a question and at least two options", () => {
    expect(
      restDecisionInputSchema.parse({
        question: "Ship on Friday?",
        options: [{ label: "Yes" }, { label: "Monday" }],
      }),
    ).toEqual({ question: "Ship on Friday?", options: [{ label: "Yes" }, { label: "Monday" }] });
    expect(
      restDecisionInputSchema.safeParse({ question: "Ship?", options: [{ label: "Yes" }] }).success,
    ).toBe(false);
    expect(
      restDecisionInputSchema.safeParse({
        question: "Ship?",
        options: Array(MAX_OPTIONS + 1).fill({ label: "x" }),
      }).success,
    ).toBe(false);
    expect(
      restDecisionInputSchema.safeParse({ question: "Ship?", options: [{ label: "" }, {}] })
        .success,
    ).toBe(false);
  });

  it("takes an answer with or without a note, and refuses an empty option", () => {
    expect(restAnswerInputSchema.parse({ option: "a" })).toEqual({ option: "a" });
    expect(restAnswerInputSchema.parse({ option: "a", note: "because" })).toEqual({
      option: "a",
      note: "because",
    });
    expect(restAnswerInputSchema.safeParse({ option: "" }).success).toBe(false);
    expect(restAnswerInputSchema.safeParse({ option: "a", note: 1 }).success).toBe(false);
  });
});

describe("what the server answers", () => {
  it("parses a task as the server writes one", () => {
    const task = restTaskSchema.parse({
      id: "0199c4d8-0000-7000-8000-000000000010",
      number: 7,
      title: "Ship",
      body: "",
      state: "in_progress",
      priority: "normal",
      owner: PERSON,
      assignee: null,
      parentId: null,
      links: [],
      openDecisions: 0,
      createdAt: "2026-10-09T10:00:00.000Z",
      updatedAt: "2026-10-09T10:00:00.000Z",
    });
    expect(task.number).toBe(7);
  });

  it("refuses an answer that is missing a key: absent values are null, never missing", () => {
    expect(
      restEventSchema.safeParse({
        id: 1,
        kind: "task.created",
        actor: PERSON,
        taskId: null,
        data: { number: 1, title: "Ship" },
        createdAt: "2026-10-09T10:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});

describe("tokens", () => {
  it("take a name alone, trimmed, and the days when said", () => {
    expect(restTokenInputSchema.parse({ name: "  Claude Code on the laptop  " })).toEqual({
      name: "Claude Code on the laptop",
    });
    expect(restTokenInputSchema.parse({ name: "ci", expiresInDays: 30 })).toEqual({
      name: "ci",
      expiresInDays: 30,
    });
  });

  it.each([
    ["an empty name", { name: " " }],
    ["a name over the limit", { name: "n".repeat(MAX_TOKEN_NAME_LENGTH + 1) }],
    ["a name with a hidden character", { name: `a${String.fromCodePoint(0x200b)}b` }],
    ["no days at all", { name: "ok", expiresInDays: 0 }],
    ["more days than allowed", { name: "ok", expiresInDays: MAX_TOKEN_DAYS + 1 }],
    ["a fraction of a day", { name: "ok", expiresInDays: 1.5 }],
    ["days as a string", { name: "ok", expiresInDays: "30" }],
    ["nothing", undefined],
  ])("refuse %s", (_, input) => {
    expect(restTokenInputSchema.safeParse(input).success).toBe(false);
  });

  it("are read as the server answers them, with the secret once and never a missing key", () => {
    const token = {
      id: "0199c4d8-0000-7000-8000-000000000030",
      name: "ci",
      createdAt: "2026-10-09T10:00:00.000Z",
      expiresAt: "2027-01-07T10:00:00.000Z",
      lastUsedAt: null,
    };
    expect(restTokensSchema.parse({ items: [token] }).items).toHaveLength(1);
    expect(restTokenCreatedSchema.parse({ token, secret: "cns_t_x" }).secret).toBe("cns_t_x");
    expect(restTokenSchema.safeParse({ ...token, lastUsedAt: undefined }).success).toBe(false);
  });
});

describe("people", () => {
  it("always say what a person is, and take a role that is one", () => {
    expect(restPersonSchema.parse(PERSON).role).toBe("member");
    const { role: _role, ...without } = PERSON;
    expect(restPersonSchema.safeParse(without).success).toBe(false);
    expect(restPersonSchema.safeParse({ ...PERSON, role: "owner" }).success).toBe(false);
    expect(restPersonPatchSchema.parse({ role: "admin" })).toEqual({ role: "admin" });
    expect(restPersonPatchSchema.safeParse({ role: "root" }).success).toBe(false);
    expect(restPersonPatchSchema.safeParse({}).success).toBe(false);
  });
});
