import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RestDecision, RestEvent, RestPerson, RestRun, RestTask, RestToken } from "../api.js";
import { Board } from "./board.js";
import { DecisionList } from "./decision-list.js";
import { describeEvent, EventFeed } from "./event-feed.js";
import { Markdown } from "./markdown.js";
import { PeopleList } from "./people.js";
import { RunList } from "./runs.js";
import { Shell } from "./shell.js";
import { SignIn } from "./sign-in.js";
import { SkillList } from "./skills.js";
import { TaskView } from "./task-view.js";
import { NewToken, TokenForm, TokenList } from "./tokens.js";

const alice: RestPerson = {
  id: "0199c4d8-0000-7000-8000-000000000001",
  login: "alice",
  name: "Alice Example",
  avatar: "https://avatars.example/alice.png",
  role: "admin",
};
const bob: RestPerson = {
  id: "0199c4d8-0000-7000-8000-000000000002",
  login: "bob",
  name: null,
  avatar: null,
  role: "member",
};

const task = (overrides: Partial<RestTask> = {}): RestTask => ({
  id: "0199c4d8-0000-7000-8000-000000000010",
  number: 7,
  title: "Ship the release <b>now</b>",
  body: "",
  state: "ready",
  priority: "high",
  owner: alice,
  assignee: bob,
  parentId: null,
  links: [],
  openDecisions: 1,
  openRuns: 0,
  createdAt: "2026-10-09T10:00:00.000Z",
  updatedAt: "2026-10-09T11:00:00.000Z",
  ...overrides,
});

const decision = (overrides: Partial<RestDecision> = {}): RestDecision => ({
  id: "0199c4d8-0000-7000-8000-000000000020",
  question: "Which one?",
  body: "",
  options: [
    { id: "1", label: "The first" },
    { id: "2", label: "The second" },
  ],
  taskId: "0199c4d8-0000-7000-8000-000000000010",
  taskNumber: 1,
  raisedBy: alice,
  run: null,
  answer: null,
  createdAt: "2026-10-09T10:00:00.000Z",
  updatedAt: "2026-10-09T10:00:00.000Z",
  ...overrides,
});

const href = (item: RestTask) => `/tasks/${item.id}`;

describe("the board", () => {
  it("has a column per state, with each task in its own, as text and never as HTML", () => {
    const html = renderToStaticMarkup(
      <Board
        tasks={[
          task(),
          task({ id: "0199c4d8-0000-7000-8000-000000000011", number: 8, state: "done" }),
        ]}
        taskHref={href}
        onOpen={() => undefined}
      />,
    );
    expect(html).toContain('aria-label="Idea"');
    expect(html).toContain('aria-label="Done"');
    expect(html).toContain("#7");
    expect(html).toContain("Ship the release &lt;b&gt;now&lt;/b&gt;");
    expect(html).not.toContain("<b>now</b>");
    expect(html).toContain("1 decision");
    expect(html).toContain("High");
    expect(html).toContain('href="/tasks/0199c4d8-0000-7000-8000-000000000010"');
    // The second task's column, with its count, and no move control without a handler.
    expect(html).toContain('class="sc-column sc-column-done"');
    expect(html).not.toContain("sc-card-move");
  });
});

describe("one task", () => {
  it("shows what it is, who it is on, its decisions and its parts", () => {
    const parent = task({ id: "0199c4d8-0000-7000-8000-000000000012", number: 1, title: "Launch" });
    const child = task({
      id: "0199c4d8-0000-7000-8000-000000000013",
      number: 9,
      title: "Draft it",
      parentId: parent.id,
    });
    const html = renderToStaticMarkup(
      <TaskView
        task={task({
          parentId: parent.id,
          body: "# Plan\n\nSee <https://example.com>.",
          links: [{ url: "https://github.com/acme/app/pull/1", label: "PR" }],
        })}
        people={[alice, bob]}
        tasks={[
          parent,
          child,
          task({
            id: "0199c4d8-0000-7000-8000-000000000014",
            number: 10,
            title: "A part",
            parentId: "0199c4d8-0000-7000-8000-000000000010",
          }),
        ]}
        decisions={[decision()]}
        taskHref={href}
        onChange={() => undefined}
        onMove={() => undefined}
        onRaiseDecision={() => undefined}
        onAnswer={() => undefined}
      />,
    );
    expect(html).toContain("Part of");
    expect(html).toContain("#1");
    expect(html).toContain("<h1>Plan</h1>");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("PR");
    expect(html).toContain("Which one?");
    expect(html).toContain("A part");
    expect(html).toContain("alice");
    expect(html).toContain("bob");
  });
});

describe("decisions", () => {
  it("list the waiting ones with their options, and the answered ones with who answered", () => {
    const answered = decision({
      id: "0199c4d8-0000-7000-8000-000000000021",
      question: "Name?",
      answer: { option: "2", note: "Shorter.", by: bob, at: "2026-10-09T12:00:00.000Z" },
    });
    const html = renderToStaticMarkup(
      <DecisionList
        decisions={[decision(), answered]}
        tasks={new Map([[task().id, task()]])}
        taskHref={href}
        onAnswer={() => undefined}
      />,
    );
    expect(html).toContain('aria-label="Waiting"');
    expect(html).toContain('aria-label="Answered"');
    expect(html).toContain('type="radio"');
    expect(html).toContain("The second");
    expect(html).toContain("Shorter.");
    expect(html).toContain("answered");
    expect(html).toContain("#7");
  });
});

describe("the feed", () => {
  const event = (overrides: Partial<RestEvent>): RestEvent => ({
    id: 1,
    kind: "task.created",
    actor: alice,
    taskId: null,
    decisionId: null,
    runId: null,
    data: {},
    createdAt: "2026-10-09T10:00:00.000Z",
    ...overrides,
  });

  it("says what happened in a sentence, per kind", () => {
    expect(describeEvent(event({ kind: "person.joined" }))).toBe("joined the board");
    expect(describeEvent(event({ data: { number: 7, title: "Ship" } }))).toBe("wrote #7 Ship");
    expect(
      describeEvent(
        event({
          kind: "task.moved",
          data: { number: 7, title: "Ship", from: "idea", to: "in_progress" },
        }),
      ),
    ).toBe("moved #7 Ship from Idea to In progress");
    expect(
      describeEvent(
        event({ kind: "task.updated", data: { number: 7, fields: ["title", "assigneeId"] } }),
      ),
    ).toBe("changed the title, the assignee of #7");
    expect(describeEvent(event({ kind: "decision.raised", data: { question: "Which?" } }))).toBe(
      "asked: Which?",
    );
    expect(
      describeEvent(
        event({ kind: "decision.answered", data: { question: "Which?", option: "The second" } }),
      ),
    ).toBe('answered "Which?": The second');
  });

  it("shows the newest first, with the actor, and the console for what it did itself", () => {
    const html = renderToStaticMarkup(
      <EventFeed
        events={[
          event({ id: 1, data: { number: 1, title: "First" } }),
          event({ id: 2, actor: null, kind: "person.joined" }),
        ]}
        href={() => "/tasks/x"}
      />,
    );
    expect(html.indexOf("joined the board")).toBeLessThan(html.indexOf("wrote #1 First"));
    expect(html).toContain("The console");
  });
});

describe("Markdown", () => {
  it("renders elements, never HTML, and links only to the web", () => {
    const html = renderToStaticMarkup(
      <Markdown
        source={
          "# Title\n\n<script>alert(1)</script>\n\n[safe](https://example.com) [bad](javascript:alert(1)) ![pic](http://insecure/x.png) ![ok](https://img.example/x.png)\n\n- [ ] a task"
        }
      />,
    );
    expect(html).toContain("<h1>Title</h1>");
    expect(html).not.toContain("<script>");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer nofollow ugc"');
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("http://insecure");
    expect(html).toContain('src="https://img.example/x.png"');
    expect(html.toLowerCase()).toContain('referrerpolicy="no-referrer"');
  });
});

describe("the shell and signing in", () => {
  it("names the board, the pages and the person", () => {
    const html = renderToStaticMarkup(
      <Shell
        title="Acme"
        nav={[
          { href: "/", label: "Board", current: true },
          { href: "/decisions", label: "Decisions", current: false, count: 2 },
        ]}
        person={alice}
        live={true}
        onNavigate={() => undefined}
        onSignOut={() => undefined}
      >
        <p>content</p>
      </Shell>,
    );
    expect(html).toContain("Acme");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('class="sc-nav-count">2<');
    expect(html).toContain("Sign out");
    expect(html).toContain("sc-live-on");
  });

  it("offers the way to each provider, and says why the last try did not complete", () => {
    const html = renderToStaticMarkup(
      <SignIn
        title="Acme"
        providers={[
          { key: "gh", label: "GitHub" },
          { key: "google", label: "Google" },
        ]}
        returnTo="/decisions"
        failure="refused"
      />,
    );
    expect(html).toContain('href="/auth/gh/login?return_to=%2Fdecisions"');
    expect(html).toContain('href="/auth/google/login?return_to=%2Fdecisions"');
    expect(html).toContain("Continue with Google");
    expect(html).toContain("not a member");
    const nobody = renderToStaticMarkup(<SignIn title="Acme" providers={[]} returnTo="/" />);
    expect(nobody).not.toContain("/auth/gh/login");
    expect(nobody).toContain("Nobody can sign in here yet");
  });
});

describe("tokens", () => {
  const token: RestToken = {
    id: "0199c4d8-0000-7000-8000-000000000030",
    name: "Claude Code <on> the laptop",
    createdAt: "2026-10-09T10:00:00.000Z",
    expiresAt: "2027-01-07T10:00:00.000Z",
    lastUsedAt: null,
  };

  it("lists what a person holds, as text, with the way to remove each when there is one", () => {
    const html = renderToStaticMarkup(
      <TokenList
        tokens={[
          token,
          {
            ...token,
            id: "0199c4d8-0000-7000-8000-000000000031",
            name: "ci",
            lastUsedAt: "2026-10-09T12:00:00.000Z",
          },
          {
            ...token,
            id: "0199c4d8-0000-7000-8000-000000000032",
            name: "forever",
            expiresAt: null,
          },
        ]}
        onRevoke={() => undefined}
      />,
    );
    expect(html).toContain("Claude Code &lt;on&gt; the laptop");
    expect(html).toContain("Never used");
    expect(html).toContain("Last used");
    expect(html).toContain("Good until");
    expect(html).toContain("Does not expire");
    expect(html.match(/>Remove</g)).toHaveLength(3);
    const readOnly = renderToStaticMarkup(<TokenList tokens={[token]} />);
    expect(readOnly).not.toContain("Remove");
    expect(renderToStaticMarkup(<TokenList tokens={[]} empty={<p>none</p>} />)).toBe("<p>none</p>");
  });

  it("asks for a name and a span, and shows a new token's secret this once", () => {
    const form = renderToStaticMarkup(<TokenForm onSubmit={() => undefined} />);
    expect(form).toContain("Name");
    expect(form).toContain("90 days");
    expect(form).toContain("Does not expire");
    expect(form).toContain("Make the token");
    const made = renderToStaticMarkup(
      <NewToken token={token} secret="cns_t_example-secret" onDone={() => undefined} />,
    );
    expect(made).toContain('<code class="sc-secret-value">cns_t_example-secret</code>');
    expect(made).toContain("shown this once");
    expect(made).toContain("Copy");
    expect(made).toContain("good until");
    const forever = renderToStaticMarkup(
      <NewToken token={{ ...token, expiresAt: null }} secret="cns_t_x" onDone={() => undefined} />,
    );
    expect(forever).toContain("It does not expire");
  });
});

describe("people", () => {
  it("lists everyone with what they are, and lets an administrator change it", () => {
    const read = renderToStaticMarkup(<PeopleList people={[alice, bob]} me={bob} />);
    expect(read).toContain("Administrator");
    expect(read).toContain("Member");
    expect(read).toContain("(you)");
    expect(read).not.toContain("<select");
    const change = renderToStaticMarkup(
      <PeopleList people={[alice, bob]} me={alice} onChangeRole={() => undefined} />,
    );
    expect(change.match(/<select/g)).toHaveLength(2);
    expect(change).toContain('value="admin"');
  });

  it("says in the feed who was made what", () => {
    const event: RestEvent = {
      id: 9,
      kind: "person.role_changed",
      actor: alice,
      taskId: null,
      decisionId: null,
      runId: null,
      data: { login: "bob", role: "admin" },
      createdAt: "2026-10-09T10:00:00.000Z",
    };
    expect(describeEvent(event)).toBe("made bob an administrator");
    expect(describeEvent({ ...event, data: { login: "bob", role: "member" } })).toBe(
      "made bob a member",
    );
  });
});

describe("runs", () => {
  const run: RestRun = {
    id: "0199c4d8-0000-7000-8000-000000000040",
    taskId: "0199c4d8-0000-7000-8000-000000000010",
    taskNumber: 1,
    person: alice,
    agent: "Claude Code <on> the laptop",
    status: "waiting",
    startedAt: "2026-10-09T10:00:00.000Z",
    endedAt: null,
    summary: null,
    reports: [
      {
        id: "0199c4d8-0000-7000-8000-000000000041",
        body: "Found the cause in **the parser**.",
        createdAt: "2026-10-09T10:05:00.000Z",
      },
    ],
    artifacts: [
      {
        id: "0199c4d8-0000-7000-8000-000000000042",
        kind: "link",
        url: "https://github.com/acme/app/pull/2",
        label: "the fix",
        file: null,
        createdAt: "2026-10-09T10:06:00.000Z",
      },
      {
        id: "0199c4d8-0000-7000-8000-000000000043",
        kind: "file",
        url: null,
        label: null,
        file: {
          name: "report <final>.md",
          size: 3500,
          contentType: "text/markdown",
          sha256: "ab".repeat(32),
        },
        createdAt: "2026-10-09T10:07:00.000Z",
      },
    ],
    waitingFor: "0199c4d8-0000-7000-8000-000000000020",
  };

  it("shows an agent at work, what it reported and handed in, and what it waits for", () => {
    const html = renderToStaticMarkup(
      <RunList
        runs={[run]}
        decisionHref={(id) => `/decisions#${id}`}
        onAbandon={() => undefined}
      />,
    );
    expect(html).toContain("Claude Code &lt;on&gt; the laptop");
    expect(html).toContain("Waiting for a decision");
    expect(html).toContain("<strong>the parser</strong>");
    expect(html).toContain('href="https://github.com/acme/app/pull/2"');
    expect(html).toContain("the fix");
    // A file is read from the console, by the artifact's id, and shown by its name and size.
    expect(html).toContain('href="/api/v1/files/0199c4d8-0000-7000-8000-000000000043"');
    expect(html).toContain("report &lt;final&gt;.md");
    expect(html).toContain("3.4 KB");
    expect(html).toContain("Mark abandoned");
    const over = renderToStaticMarkup(
      <RunList
        runs={[
          {
            ...run,
            status: "finished",
            endedAt: "2026-10-09T11:00:00.000Z",
            summary: "Done.",
            waitingFor: null,
          },
        ]}
        onAbandon={() => undefined}
      />,
    );
    expect(over).toContain("Finished");
    expect(over).toContain("Done.");
    expect(over).not.toContain("Mark abandoned");
    expect(renderToStaticMarkup(<RunList runs={[]} empty={<p>none</p>} />)).toBe("<p>none</p>");
  });

  it("says in the feed what an agent did, as itself", () => {
    const event: RestEvent = {
      id: 10,
      kind: "run.started",
      actor: alice,
      taskId: run.taskId,
      decisionId: null,
      runId: run.id,
      data: { number: 7, title: "Ship", agent: "Claude Code" },
      createdAt: "2026-10-09T10:00:00.000Z",
    };
    expect(describeEvent(event)).toBe("started on #7 Ship (as Claude Code)");
    expect(
      describeEvent({
        ...event,
        kind: "run.reported",
        data: { ...event.data, excerpt: "Found it" },
      }),
    ).toBe("reported on #7 Ship (as Claude Code): Found it");
    expect(
      describeEvent({ ...event, kind: "run.handed_in", data: { ...event.data, label: "the fix" } }),
    ).toBe("handed in the fix on #7 Ship (as Claude Code)");
    expect(
      describeEvent({ ...event, kind: "run.ended", data: { ...event.data, status: "abandoned" } }),
    ).toBe("gave up on #7 Ship (as Claude Code)");
    expect(
      describeEvent({
        ...event,
        kind: "decision.raised",
        data: { question: "Which?", agent: "Claude Code" },
      }),
    ).toBe("asked (as Claude Code): Which?");
  });

  it("marks a task an agent is at work on", () => {
    const html = renderToStaticMarkup(
      <Board tasks={[task({ openRuns: 1 })]} taskHref={href} onOpen={() => undefined} />,
    );
    expect(html).toContain("agent at work");
  });
});

describe("skills", () => {
  const served = {
    address: "/gh/acme/skills",
    source: "https://skillcdn.test",
    page: "https://skillcdn.test/gh/acme/skills",
    status: "ready" as const,
    items: [
      {
        name: "review",
        description: "Reviews a <change>.",
        directory: "review",
        path: "review/SKILL.md",
        page: "https://skillcdn.test/gh/acme/skills?skill=review%2FSKILL.md",
        uri: "skill://gh/acme/skills/review/SKILL.md",
        translations: {},
      },
    ],
  };

  it("list what SkillCDN serves at the address, as text, with where each is read and loaded", () => {
    const html = renderToStaticMarkup(<SkillList skills={served} />);
    expect(html).toContain('href="https://skillcdn.test/gh/acme/skills"');
    expect(html).toContain('href="https://skillcdn.test/gh/acme/skills?skill=review%2FSKILL.md"');
    expect(html).toContain("Reviews a &lt;change&gt;.");
    expect(html).toContain("skill://gh/acme/skills/review/SKILL.md");
    expect(html).not.toContain("<change>");
  });

  it("say when there is no address, when the deployment is still indexing, and while loading", () => {
    expect(renderToStaticMarkup(<SkillList skills={undefined} />)).toContain("Loading the skills");
    const none = renderToStaticMarkup(
      <SkillList
        skills={{
          address: null,
          source: "https://skillcdn.ai",
          page: null,
          status: "none",
          items: [],
        }}
      />,
    );
    expect(none).toContain("No skills address yet");
    const indexing = renderToStaticMarkup(
      <SkillList skills={{ ...served, status: "indexing", items: [] }} />,
    );
    expect(indexing).toContain("still indexing");
    expect(indexing).toContain("/gh/acme/skills");
  });
});
