import { describe, expect, it } from "vitest";
import {
  MAX_BODY_LENGTH,
  MAX_DOCUMENT_LENGTH,
  MAX_LINKS,
  MAX_OPTIONS,
  MAX_PROJECT_KEY_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_TOKEN_DAYS,
  MAX_TOKEN_NAME_LENGTH,
} from "./limits.js";
import {
  hostOfLogin,
  isLoginAt,
  restAnswerInputSchema,
  restCategoryInputSchema,
  restDecisionInputSchema,
  restDecisionPatchSchema,
  restDocumentInputSchema,
  restDocumentSchema,
  restDocumentsSchema,
  restEventSchema,
  restGoalInputSchema,
  restGoalSchema,
  restListingInputSchema,
  restMemberInputSchema,
  restPersonPatchSchema,
  restPersonSchema,
  restProjectIconSchema,
  restProjectInputSchema,
  restProjectPatchSchema,
  restProjectSchema,
  restTaskInputSchema,
  restTaskPatchSchema,
  restTaskSchema,
  restTokenCreatedSchema,
  restTokenInputSchema,
  restTokenSchema,
  restTokensSchema,
  restWorkSchema,
} from "./schemas.js";

const PERSON = {
  id: "0199c4d8-0000-7000-8000-000000000001",
  login: "alice",
  name: "Alice Example",
  avatar: "https://avatars.example/alice.png",
  role: "member" as const,
  status: "active" as const,
  source: "listed" as const,
  deactivatedAt: null,
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
    ["a day that is not one", { title: "t", dueOn: "next week" }],
    ["an instant for a day", { title: "t", startsOn: "2026-10-20T00:00:00Z" }],
    ["a month for a day", { title: "t", dueOn: "2026-10" }],
    ["a category that is not a key", { title: "t", category: "Not A Key" }],
    ["a goal that is not an id", { title: "t", goalId: "ship" }],
    ["nothing", undefined],
  ])("refuses %s", (_, input) => {
    expect(restTaskInputSchema.safeParse(input).success).toBe(false);
  });

  it("takes the plan in days, a category by its key, and a goal by its id, each or null", () => {
    expect(
      restTaskInputSchema.parse({
        title: "Plan",
        startsOn: "2026-10-20",
        dueOn: "2026-10-24",
        category: "engineering",
        goalId: PERSON.id,
      }),
    ).toMatchObject({
      startsOn: "2026-10-20",
      dueOn: "2026-10-24",
      category: "engineering",
      goalId: PERSON.id,
    });
    expect(restTaskPatchSchema.parse({ dueOn: null, category: null, goalId: null })).toEqual({
      dueOn: null,
      category: null,
      goalId: null,
    });
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
      category: { key: "engineering", name: "Engineering", color: "blue" },
      goalId: null,
      startsOn: "2026-10-20",
      dueOn: null,
      startedAt: "2026-10-21T09:00:00.000Z",
      doneAt: null,
      links: [],
      openDecisions: 0,
      openRuns: 0,
      createdAt: "2026-10-09T10:00:00.000Z",
      updatedAt: "2026-10-09T10:00:00.000Z",
    });
    expect(task.number).toBe(7);
    expect(task.category?.color).toBe("blue");
  });

  it("parses a goal with its tasks counted, and a person's work with its projects", () => {
    const goal = restGoalSchema.parse({
      id: "0199c4d8-0000-7000-8000-000000000030",
      title: "Ship",
      body: "",
      state: "active",
      dueOn: "2026-11-15",
      createdBy: PERSON,
      taskCounts: { idea: 0, ready: 1, in_progress: 0, in_review: 0, done: 2, dropped: 0 },
      createdAt: "2026-10-09T10:00:00.000Z",
      updatedAt: "2026-10-09T10:00:00.000Z",
    });
    expect(goal.taskCounts.done).toBe(2);
    expect(restWorkSchema.parse({ tasks: [], decisions: [] })).toEqual({
      tasks: [],
      decisions: [],
    });
    expect(
      restWorkSchema.safeParse({
        tasks: [{ project: { key: "Web", name: "x" }, task: {} }],
        decisions: [],
      }).success,
    ).toBe(false);
  });

  it("refuses an answer that is missing a key: absent values are null, never missing", () => {
    const event = {
      id: 1,
      kind: "task.created",
      actor: PERSON,
      agent: null,
      projectId: "0199c4d8-0000-7000-8000-000000000050",
      taskId: null,
      decisionId: null,
      runId: null,
      documentId: null,
      goalId: null,
      data: { number: 1, title: "Ship" },
      createdAt: "2026-10-09T10:00:00.000Z",
    };
    expect(restEventSchema.safeParse(event).success).toBe(true);
    const { agent: _agent, ...withoutAgent } = event;
    expect(restEventSchema.safeParse(withoutAgent).success).toBe(false);
    const { projectId: _projectId, ...withoutProject } = event;
    expect(restEventSchema.safeParse(withoutProject).success).toBe(false);
  });
});

describe("projects", () => {
  it("take a key and a name, with the rest by default, and change everything but the key", () => {
    expect(restProjectInputSchema.parse({ key: "web-2", name: "  The web app  " })).toEqual({
      key: "web-2",
      name: "The web app",
    });
    expect(
      restProjectInputSchema.parse({
        key: "ops",
        name: "Ops",
        description: "What we run.\nAnd keep.",
        visibility: "workspace",
        skillsAddress: "/gh/acme/skills",
      }).visibility,
    ).toBe("workspace");
    expect(restProjectPatchSchema.parse({ skillsAddress: null })).toEqual({ skillsAddress: null });
    expect(restProjectPatchSchema.safeParse({ key: "other" }).success).toBe(true);
    expect(restProjectPatchSchema.parse({ key: "other" })).toEqual({});
    expect(restMemberInputSchema.parse({ personId: PERSON.id })).toEqual({ personId: PERSON.id });
  });

  it.each([
    ["an empty key", { key: "", name: "x" }],
    ["a key with capitals", { key: "Web", name: "x" }],
    ["a key with a space", { key: "the web", name: "x" }],
    ["a key that ends in a hyphen", { key: "web-", name: "x" }],
    ["a key that begins with a hyphen", { key: "-web", name: "x" }],
    ["a key over the limit", { key: "k".repeat(MAX_PROJECT_KEY_LENGTH + 1), name: "x" }],
    ["a key with a slash", { key: "a/b", name: "x" }],
    ["a key the pages reserve", { key: "new", name: "x" }],
    ["no name", { key: "web" }],
    ["a visibility that is not one", { key: "web", name: "x", visibility: "public" }],
    [
      "an address that hides a character",
      { key: "web", name: "x", skillsAddress: `/gh/a${String.fromCodePoint(0x200b)}b/c` },
    ],
    ["a member role that is not one", { key: "web", name: "x", role: "viewer" }],
  ])("refuse %s", (_, input) => {
    expect(restProjectInputSchema.safeParse(input).success).toBe("role" in input);
    if ("role" in input) {
      expect(
        restMemberInputSchema.safeParse({ personId: PERSON.id, role: input.role }).success,
      ).toBe(false);
    }
  });

  it("are read as the server answers them, with what the asker is in each", () => {
    const project = restProjectSchema.parse({
      color: "teal",
      symbol: "W",
      icon: null,
      id: "0199c4d8-0000-7000-8000-000000000050",
      key: "web",
      name: "The web app",
      description: "",
      visibility: "private",
      skillsAddress: null,
      role: "owner",
      openDecisions: 0,
      openRuns: 1,
      createdAt: "2026-10-09T10:00:00.000Z",
      updatedAt: "2026-10-09T10:00:00.000Z",
    });
    expect(project.role).toBe("owner");
    expect(restProjectSchema.safeParse({ ...project, role: "admin" }).success).toBe(false);
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
    expect(restTokenInputSchema.parse({ name: "forever", expiresInDays: null })).toEqual({
      name: "forever",
      expiresInDays: null,
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
    ["days as a word", { name: "ok", expiresInDays: "never" }],
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
      client: null,
    };
    expect(restTokensSchema.parse({ items: [token] }).items).toHaveLength(1);
    expect(restTokenCreatedSchema.parse({ token, secret: "cns_t_x" }).secret).toBe("cns_t_x");
    expect(restTokenSchema.safeParse({ ...token, lastUsedAt: undefined }).success).toBe(false);
    expect(restTokenSchema.safeParse({ ...token, expiresAt: null }).success).toBe(true);
  });
});

describe("people", () => {
  it("always say what a person is, and take a role that is one", () => {
    expect(restPersonSchema.parse(PERSON).role).toBe("member");
    const { role: _role, ...without } = PERSON;
    expect(restPersonSchema.safeParse(without).success).toBe(false);
    expect(restPersonSchema.safeParse({ ...PERSON, role: "owner" }).success).toBe(false);
    expect(restPersonPatchSchema.parse({ role: "admin" })).toEqual({ role: "admin" });
    expect(restPersonPatchSchema.parse({ status: "deactivated" })).toEqual({
      status: "deactivated",
    });
    expect(restPersonPatchSchema.safeParse({ role: "root" }).success).toBe(false);
    expect(restPersonPatchSchema.safeParse({ status: "gone" }).success).toBe(false);
    expect(restPersonPatchSchema.safeParse({}).success).toBe(false);
    // Whether they are in, and what let them in, always travel with a person.
    const { status: _status, ...noStanding } = PERSON;
    expect(restPersonSchema.safeParse(noStanding).success).toBe(false);
    expect(restPersonSchema.safeParse({ ...PERSON, source: "ldap" }).success).toBe(false);
  });

  it("take a login to let in as its host spells one, and read the host off a login", () => {
    expect(restListingInputSchema.parse({ host: "gh", login: " Dana " })).toEqual({
      host: "gh",
      login: "Dana",
    });
    expect(restListingInputSchema.parse({ host: "google", login: "dana@acme.test" }).login).toBe(
      "dana@acme.test",
    );
    for (const input of [
      { host: "gh", login: "dana@acme.test" },
      { host: "gh", login: "-dana" },
      { host: "gh", login: "not a login" },
      { host: "google", login: "dana" },
      { host: "google", login: "dana@acme" },
      { host: "gitlab", login: "dana" },
      { host: "gh", login: "" },
      { host: "google", login: `${"a".repeat(250)}@acme.test` },
    ]) {
      expect(restListingInputSchema.safeParse(input).success, JSON.stringify(input)).toBe(false);
    }
    expect(hostOfLogin("dana")).toBe("gh");
    expect(hostOfLogin("dana@acme.test")).toBe("google");
    expect(isLoginAt("gh", "dana-1")).toBe(true);
    expect(isLoginAt("google", "dana-1")).toBe(false);
  });
});

describe("documents", () => {
  const summary = {
    id: "0199c4d8-0000-7000-8000-000000000060",
    path: "guides/onboarding",
    title: "Onboarding",
    version: 2,
    updatedBy: PERSON,
    agent: "Claude Code",
    archivedAt: null,
    createdAt: "2026-10-10T10:00:00.000Z",
    updatedAt: "2026-10-10T11:00:00.000Z",
  };

  it("take a title and a body at a path, trimmed and bounded, with the version started from", () => {
    expect(restDocumentInputSchema.parse({ title: "  Onboarding  ", body: "# Hi\n" })).toEqual({
      title: "Onboarding",
      body: "# Hi\n",
    });
    expect(
      restDocumentInputSchema.parse({ title: "x", body: "", baseVersion: 3 }).baseVersion,
    ).toBe(3);
    expect(
      restDocumentInputSchema.safeParse({ title: "x", body: "a".repeat(MAX_DOCUMENT_LENGTH + 1) })
        .success,
    ).toBe(false);
    expect(
      restDocumentInputSchema.safeParse({ title: "x", body: "ok", baseVersion: 0 }).success,
    ).toBe(false);
    expect(restDocumentInputSchema.safeParse({ title: "", body: "ok" }).success).toBe(false);
    expect(restDecisionPatchSchema.parse({ outcome: "Done." })).toEqual({ outcome: "Done." });
    expect(restDecisionPatchSchema.parse({})).toEqual({});
  });

  it("are read as the server answers them, with the links both ways and the files, and refuse a path that is not one", () => {
    const document = {
      ...summary,
      body: "See [the plan](plan).",
      createdBy: PERSON,
      links: [{ path: "plan", title: null }],
      backlinks: [
        {
          kind: "task",
          id: "0199c4d8-0000-7000-8000-000000000010",
          path: null,
          number: 7,
          title: "Ship",
        },
      ],
      files: [],
    };
    expect(restDocumentSchema.parse(document)).toEqual(document);
    expect(restDocumentSchema.safeParse({ ...document, path: "Guides/x" }).success).toBe(false);
    expect(restDocumentSchema.safeParse({ ...document, links: undefined }).success).toBe(false);
    expect(
      restDocumentsSchema.parse({ folder: "guides", folders: ["guides/setup"], items: [summary] })
        .items[0]?.path,
    ).toBe("guides/onboarding");
  });
});

describe("categories and goals", () => {
  it("take a category's key as a project's, with a colour from the list, and a goal's title with the rest by default", () => {
    expect(restCategoryInputSchema.parse({ key: "research", name: " Research " })).toEqual({
      key: "research",
      name: "Research",
    });
    expect(restCategoryInputSchema.parse({ key: "r-d", name: "R&D", color: "teal" }).color).toBe(
      "teal",
    );
    for (const input of [
      { key: "Research", name: "x" },
      { key: "re search", name: "x" },
      { key: "research-", name: "x" },
      { key: "research", name: "" },
      { key: "research", name: "x", color: "#fff" },
      { key: "research", name: `x${String.fromCodePoint(0x200b)}` },
    ]) {
      expect(restCategoryInputSchema.safeParse(input).success, JSON.stringify(input)).toBe(false);
    }
    expect(restGoalInputSchema.parse({ title: " Ship v1 " })).toEqual({ title: "Ship v1" });
    expect(restGoalInputSchema.parse({ title: "Ship", state: "active", dueOn: null })).toEqual({
      title: "Ship",
      state: "active",
      dueOn: null,
    });
    for (const input of [
      { title: "" },
      { title: "x", state: "open" },
      { title: "x", dueOn: "soon" },
      { title: "x", body: "b".repeat(MAX_BODY_LENGTH + 1) },
    ]) {
      expect(restGoalInputSchema.safeParse(input).success, JSON.stringify(input)).toBe(false);
    }
  });
});

describe("a project's image for its mark", () => {
  it("is the hash it is kept by and one of the kinds the pages show, and nothing else", () => {
    const sha256 = "a".repeat(64);
    expect(restProjectIconSchema.parse({ sha256, contentType: "image/webp" })).toEqual({
      sha256,
      contentType: "image/webp",
    });
    expect(restProjectIconSchema.safeParse({ sha256, contentType: "image/svg+xml" }).success).toBe(
      false,
    );
    expect(
      restProjectIconSchema.safeParse({ sha256: "abc", contentType: "image/png" }).success,
    ).toBe(false);
  });
});
