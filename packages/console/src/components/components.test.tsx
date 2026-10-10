import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  RestConnectRequest,
  RestDecision,
  RestDocument,
  RestEvent,
  RestMember,
  RestPerson,
  RestProject,
  RestRun,
  RestTask,
  RestToken,
} from "../api.js";
import { Board } from "./board.js";
import { ConnectApproval, ConnectCodeForm, ConnectWords } from "./connect.js";
import { DecisionCard, DecisionList } from "./decision-list.js";
import { DocumentForm, DocumentList, DocumentView, FolderView } from "./documents.js";
import { describeEvent, EventFeed } from "./event-feed.js";
import { Markdown } from "./markdown.js";
import { PeopleList } from "./people.js";
import { keyOf, MemberList, ProjectForm, ProjectList } from "./projects.js";
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
  outcome: null,
  createdAt: "2026-10-09T10:00:00.000Z",
  updatedAt: "2026-10-09T10:00:00.000Z",
  ...overrides,
});

const href = (item: RestTask) => `/projects/web/tasks/${item.number}`;

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
    expect(html).toContain('href="/projects/web/tasks/7"');
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
        history={[
          {
            id: 3,
            kind: "task.moved",
            actor: bob,
            agent: "Claude Code",
            projectId: null,
            taskId: "0199c4d8-0000-7000-8000-000000000010",
            decisionId: null,
            runId: null,
            documentId: null,
            data: { number: 7, title: "Ship", from: "ready", to: "in_progress" },
            createdAt: "2026-10-09T10:00:00.000Z",
          },
        ]}
        taskHref={href}
        onChange={() => undefined}
        onMove={() => undefined}
        onRaiseDecision={() => undefined}
        onAnswer={() => undefined}
      />,
    );
    expect(html).toContain("Part of");
    // Everything that happened to it, with the agent a person acted through.
    expect(html).toContain('aria-label="History"');
    expect(html).toContain("moved #7 Ship from Ready to In progress");
    expect(html).toContain("as Claude Code");
    expect(html).toContain("#1");
    expect(html).toContain("<h1>Plan</h1>");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("PR");
    expect(html).toContain("Which one?");
    expect(html).toContain("A part");
    expect(html).toContain("alice");
    expect(html).toContain("bob");
  });

  it("opens the form the page says, each at an address of its own", () => {
    const render = (form: "edit" | "ask" | undefined) =>
      renderToStaticMarkup(
        <TaskView
          task={task()}
          people={[alice, bob]}
          tasks={[task()]}
          decisions={[]}
          taskHref={href}
          form={form}
          formHref={(wanted) => `/projects/web/tasks/7?${wanted}`}
          onCancel={() => undefined}
          onChange={() => undefined}
          onMove={() => undefined}
          onRaiseDecision={() => undefined}
          onAnswer={() => undefined}
        />,
      );
    const plain = render(undefined);
    expect(plain).toContain('href="/projects/web/tasks/7?edit"');
    expect(plain).toContain('href="/projects/web/tasks/7?ask"');
    expect(plain).not.toContain('aria-label="Raise a decision"');
    const asking = render("ask");
    expect(asking).toContain('aria-label="Raise a decision"');
    expect(asking).toContain("Cancel");
    const editing = render("edit");
    expect(editing).toContain("<form");
    expect(editing).not.toContain('href="/projects/web/tasks/7?edit"');
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

  it("read as a record: the context, the rationale, and what followed, with the way to write it", () => {
    const answered = decision({
      body: "It rests on [the plan](plan).",
      answer: {
        option: "2",
        note: "Because of [the numbers](numbers).",
        by: bob,
        at: "2026-10-09T12:00:00.000Z",
      },
      outcome: "We shipped it; see [what came of it](outcomes/ship).",
    });
    const html = renderToStaticMarkup(
      <DecisionCard
        decision={answered}
        docHref={(path) => `/projects/web/docs/${path}`}
        onUpdate={() => undefined}
      />,
    );
    expect(html).toContain(`id="${answered.id}"`);
    expect(html).toContain("Context");
    expect(html).toContain('href="/projects/web/docs/plan"');
    expect(html).toContain('href="/projects/web/docs/numbers"');
    expect(html).toContain("What followed");
    expect(html).toContain('href="/projects/web/docs/outcomes/ship"');
    expect(html).toContain("Change it");
    const bare = renderToStaticMarkup(
      <DecisionCard decision={decision({ answer: answered.answer })} />,
    );
    expect(bare).not.toContain("What followed");
    const writable = renderToStaticMarkup(
      <DecisionCard decision={decision({ answer: answered.answer })} onUpdate={() => undefined} />,
    );
    expect(writable).toContain("Write what followed");
  });
});

describe("the feed", () => {
  const event = (overrides: Partial<RestEvent>): RestEvent => ({
    id: 1,
    kind: "task.created",
    actor: alice,
    agent: null,
    documentId: null,
    projectId: null,
    taskId: null,
    decisionId: null,
    runId: null,
    data: {},
    createdAt: "2026-10-09T10:00:00.000Z",
    ...overrides,
  });

  it("says what happened to a page, and to a decision's record", () => {
    const written = event({
      kind: "document.written",
      data: { path: "guides/onboarding", title: "Onboarding", version: 2 },
    });
    expect(describeEvent(written)).toBe("wrote the page Onboarding, version 2");
    expect(describeEvent(event({ kind: "document.archived", data: { path: "plan" } }))).toBe(
      "archived the page plan",
    );
    expect(
      describeEvent(
        event({
          kind: "document.file_attached",
          data: { path: "plan", title: "The plan", label: "the report" },
        }),
      ),
    ).toBe("attached the report to the page The plan");
    expect(
      describeEvent(
        event({ kind: "decision.updated", data: { question: "Which one?", fields: ["outcome"] } }),
      ),
    ).toBe('wrote what followed of the decision "Which one?"');
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

  it("shows the newest first, with the actor and the agent they acted through, and the console for what it did itself", () => {
    const html = renderToStaticMarkup(
      <EventFeed
        events={[
          event({ id: 1, data: { number: 1, title: "First" } }),
          event({ id: 2, actor: null, kind: "person.joined" }),
          event({
            id: 3,
            agent: "Claude Code <on> the laptop",
            data: { number: 2, title: "Second" },
          }),
        ]}
        href={() => "/projects/web/tasks/x"}
      />,
    );
    expect(html.indexOf("joined the board")).toBeLessThan(html.indexOf("wrote #1 First"));
    expect(html).toContain("The console");
    expect(html).toContain("as Claude Code &lt;on&gt; the laptop");
    expect(html.match(/sc-feed-agent/g)).toHaveLength(1);
  });

  it("says what happened to a project, and who was added to it as what", () => {
    const project = { key: "web", name: "The web app" };
    expect(describeEvent(event({ kind: "project.created", data: project }))).toBe(
      "made the project The web app",
    );
    expect(
      describeEvent(
        event({ kind: "project.updated", data: { ...project, fields: ["name", "skillsAddress"] } }),
      ),
    ).toBe("changed the name, the skills address of the project The web app");
    expect(
      describeEvent(
        event({ kind: "project.member_added", data: { ...project, login: "bob", role: "owner" } }),
      ),
    ).toBe("added bob to The web app as an owner");
    expect(
      describeEvent(
        event({
          kind: "project.member_changed",
          data: { ...project, login: "bob", role: "member" },
        }),
      ),
    ).toBe("made bob a member of The web app");
    expect(
      describeEvent(event({ kind: "project.member_removed", data: { ...project, login: "bob" } })),
    ).toBe("removed bob from The web app");
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

  it("leads a link to a page's path to the page, when it knows where, and leaves it text otherwise", () => {
    const source = "See [onboarding](guides/onboarding#setup) and [nothing](Guides/x).";
    const linked = renderToStaticMarkup(
      <Markdown source={source} docHref={(path) => `/projects/web/docs/${path}`} />,
    );
    expect(linked).toContain('<a href="/projects/web/docs/guides/onboarding#setup">onboarding</a>');
    expect(linked).toContain("<span>nothing</span>");
    const unlinked = renderToStaticMarkup(<Markdown source={source} />);
    expect(unlinked).toContain("<span>onboarding</span>");
  });
});

describe("documents", () => {
  const document = (overrides: Partial<RestDocument> = {}): RestDocument => ({
    id: "0199c4d8-0000-7000-8000-000000000060",
    path: "guides/onboarding",
    title: "Onboarding <new>",
    version: 3,
    updatedBy: bob,
    agent: "Claude Code",
    archivedAt: null,
    createdAt: "2026-10-10T10:00:00.000Z",
    updatedAt: "2026-10-10T11:00:00.000Z",
    body: "# Welcome\n\nRead [the plan](plan) first.",
    createdBy: alice,
    links: [
      { path: "plan", title: "The plan" },
      { path: "guides/setup", title: null },
    ],
    backlinks: [
      {
        kind: "document",
        id: "0199c4d8-0000-7000-8000-000000000061",
        path: "plan",
        number: null,
        title: "The plan",
      },
      {
        kind: "task",
        id: "0199c4d8-0000-7000-8000-000000000010",
        path: null,
        number: 7,
        title: "Ship",
      },
      {
        kind: "decision",
        id: "0199c4d8-0000-7000-8000-000000000020",
        path: null,
        number: null,
        title: "Which one?",
      },
    ],
    files: [
      {
        id: "0199c4d8-0000-7000-8000-000000000070",
        label: "the report",
        file: { name: "report.pdf", size: 2048, contentType: "application/pdf", sha256: "ab" },
        addedBy: alice,
        agent: null,
        createdAt: "2026-10-10T11:00:00.000Z",
      },
    ],
    ...overrides,
  });
  const docHref = (path: string) => `/projects/web/docs/${path}`;
  const folderHref = (folder: string) =>
    folder === "" ? "/projects/web/docs" : `/projects/web/docs/${folder}`;

  it("show a page with its links both ways, its files and its versions, as text and never as HTML", () => {
    const html = renderToStaticMarkup(
      <DocumentView
        document={document()}
        versions={[
          {
            number: 3,
            title: "Onboarding <new>",
            author: bob,
            agent: "Claude Code",
            createdAt: "2026-10-10T11:00:00.000Z",
          },
          {
            number: 2,
            title: "Onboarding",
            author: alice,
            agent: null,
            createdAt: "2026-10-10T10:30:00.000Z",
          },
        ]}
        docHref={docHref}
        folderHref={folderHref}
        fileHref={(file) => `/api/v1/projects/web/docs/guides%2Fonboarding/files/${file.id}`}
        taskHref={(backlink) => `/projects/web/tasks/${backlink.number}`}
        decisionHref={(id) => `/projects/web/decisions/${id}`}
        editHref="/projects/web/docs/guides/onboarding?edit"
        onArchive={() => undefined}
        versionHref={(number) =>
          number === undefined
            ? "/projects/web/docs/guides/onboarding"
            : `/projects/web/docs/guides/onboarding?version=${number}`
        }
      />,
    );
    expect(html).toContain("Onboarding &lt;new&gt;");
    expect(html).not.toContain("<new>");
    expect(html).toContain("<h1>Welcome</h1>");
    expect(html).toContain('href="/projects/web/docs/plan"');
    expect(html).toContain("no page there yet");
    expect(html).toContain("Referred to by");
    expect(html).toContain('href="/projects/web/tasks/7"');
    expect(html).toContain('href="/projects/web/decisions/0199c4d8-0000-7000-8000-000000000020"');
    expect(html).toContain('href="/projects/web/docs/guides/onboarding?edit"');
    expect(html).toContain('href="/projects/web/docs/guides/onboarding?version=2"');
    expect(html).toContain("Decision: Which one?");
    expect(html).toContain("the report");
    expect(html).toContain("2.0 KB");
    expect(html).toContain("as Claude Code");
    expect(html).toContain("v2");
    expect(html).toContain("Archive");
    expect(html).toContain(">Docs</a>");
    const archived = renderToStaticMarkup(
      <DocumentView
        document={document({ archivedAt: "2026-10-10T12:00:00.000Z" })}
        docHref={docHref}
        folderHref={folderHref}
        fileHref={() => "#"}
        editHref="/projects/web/docs/guides/onboarding?edit"
        onRestore={() => undefined}
      />,
    );
    expect(archived).toContain("Archived");
    expect(archived).toContain("Restore");
    expect(archived).not.toContain(">Edit<");
  });

  it("list a folder's folders and pages, and ask for a path, a title and a body when writing", () => {
    const folder = renderToStaticMarkup(
      <FolderView
        listing={{
          folder: "guides",
          folders: ["guides/setup"],
          items: [document({ archivedAt: "2026-10-10T12:00:00.000Z" })],
        }}
        docHref={docHref}
        folderHref={folderHref}
      />,
    );
    expect(folder).toContain('href="/projects/web/docs/guides/setup"');
    expect(folder).toContain("setup/");
    expect(folder).toContain('href="/projects/web/docs/guides/onboarding"');
    expect(folder).toContain("Archived");
    const empty = renderToStaticMarkup(
      <DocumentList items={[]} docHref={docHref} empty={<p>Nothing</p>} />,
    );
    expect(empty).toContain("Nothing");
    const fresh = renderToStaticMarkup(<DocumentForm folder="guides" onSubmit={() => undefined} />);
    expect(fresh).toContain('value="guides/"');
    expect(fresh).toContain("Write the page");
    const again = renderToStaticMarkup(
      <DocumentForm document={document()} onSubmit={() => undefined} />,
    );
    expect(again).toMatch(/<input[^>]*disabled[^>]*value="guides\/onboarding"/);
    expect(again).toContain("Write a new version");
  });
});

describe("the shell and signing in", () => {
  it("names the board, the pages and the person", () => {
    const html = renderToStaticMarkup(
      <Shell
        title="Acme"
        project={{ name: "The web app", href: "/projects/web" }}
        nav={[
          { href: "/projects/web", label: "Board", current: true },
          { href: "/projects/web/decisions", label: "Decisions", current: false, count: 2 },
        ]}
        menu={[{ href: "/agents", label: "Agents", current: false }]}
        person={alice}
        live={true}
        onNavigate={() => undefined}
        onSignOut={() => undefined}
      >
        <p>content</p>
      </Shell>,
    );
    expect(html).toContain("Acme");
    expect(html).toContain('class="sc-tab sc-tab-current"');
    expect(html).toContain('class="sc-menu"');
    expect(html).toContain('href="/agents"');
    expect(html).toContain('class="sc-crumb-link" href="/projects/web"');
    expect(html).toContain("The web app");
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
    expect(html).toContain("Not active yet");
    expect(html).toContain("Last active");
    expect(html).toContain("Good until");
    expect(html).toContain("Does not expire");
    expect(html.match(/>Disconnect</g)).toHaveLength(3);
    const readOnly = renderToStaticMarkup(<TokenList tokens={[token]} />);
    expect(readOnly).not.toContain("Disconnect");
    expect(renderToStaticMarkup(<TokenList tokens={[]} empty={<p>none</p>} />)).toBe("<p>none</p>");
  });

  it("asks for a name and a span, and shows a new token's secret this once", () => {
    const form = renderToStaticMarkup(<TokenForm onSubmit={() => undefined} />);
    expect(form).toContain("Name");
    expect(form).toContain("90 days");
    expect(form).toContain("Does not expire");
    expect(form).toContain("Make the token");
    // Where the organization requires an expiry, the form offers no more than it allows.
    const bounded = renderToStaticMarkup(<TokenForm daysAtMost={45} onSubmit={() => undefined} />);
    expect(bounded).toContain("30 days");
    expect(bounded).toContain("45 days");
    expect(bounded).not.toContain("90 days");
    expect(bounded).not.toContain("Does not expire");
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

describe("connecting an agent", () => {
  const request: RestConnectRequest = {
    code: "ABCD-EFGH",
    agent: "Claude Code on <the> laptop",
    createdAt: "2026-10-10T10:00:00.000Z",
    expiresAt: "2026-10-10T10:10:00.000Z",
    approved: false,
  };

  it("asks for the code, shows what asks with the way to approve or refuse it, and says what to tell the agent", () => {
    const form = renderToStaticMarkup(<ConnectCodeForm onSubmit={() => undefined} />);
    expect(form).toContain('placeholder="ABCD-EFGH"');
    const approval = renderToStaticMarkup(
      <ConnectApproval
        request={request}
        daysAtMost={30}
        onApprove={() => undefined}
        onDeny={() => undefined}
      />,
    );
    expect(approval).toContain("Claude Code on &lt;the&gt; laptop");
    expect(approval).not.toContain("<the>");
    expect(approval).toContain("ABCD-EFGH");
    expect(approval).toContain(">Approve<");
    expect(approval).toContain(">Not mine<");
    expect(approval).toContain('value="Claude Code on &lt;the&gt; laptop"');
    expect(approval).toContain("30 days");
    expect(approval).not.toContain("Does not expire");
    const words = renderToStaticMarkup(<ConnectWords origin="https://console.test" />);
    expect(words).toContain("console login --url https://console.test");
    expect(words).toContain("Tell your agent");
  });
});

describe("people", () => {
  it("lists everyone with what they are, and lets an administrator change it", () => {
    const read = renderToStaticMarkup(<PeopleList people={[alice, bob]} me={bob} />);
    expect(read).toContain("Administrator");
    const seen = renderToStaticMarkup(
      <PeopleList people={[alice]} agentsHref={(person) => `/people/${person.id}/agents`} />,
    );
    expect(seen).toContain(`href="/people/${alice.id}/agents"`);
    expect(read).not.toContain("/agents");
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
      agent: null,
      projectId: null,
      taskId: null,
      decisionId: null,
      runId: null,
      documentId: null,
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
        decisionHref={(id) => `/projects/web/decisions#${id}`}
        fileHref={(artifact) => `/api/v1/projects/web/files/${artifact.id}`}
        onAbandon={() => undefined}
      />,
    );
    expect(html).toContain("Claude Code &lt;on&gt; the laptop");
    expect(html).toContain("Waiting for a decision");
    expect(html).toContain("<strong>the parser</strong>");
    expect(html).toContain('href="https://github.com/acme/app/pull/2"');
    expect(html).toContain("the fix");
    // A file is read from the console, by the artifact's id, and shown by its name and size.
    expect(html).toContain(
      'href="/api/v1/projects/web/files/0199c4d8-0000-7000-8000-000000000043"',
    );
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
    // Without the way to read a file, it is named and not linked.
    const unlinked = renderToStaticMarkup(<RunList runs={[run]} />);
    expect(unlinked).not.toContain("/files/");
    expect(unlinked).toContain("report &lt;final&gt;.md");
  });

  it("says in the feed what an agent did; the agent itself is the line's own", () => {
    const event: RestEvent = {
      id: 10,
      kind: "run.started",
      actor: alice,
      agent: "Claude Code",
      projectId: null,
      taskId: run.taskId,
      decisionId: null,
      runId: run.id,
      documentId: null,
      data: { number: 7, title: "Ship", agent: "Claude Code" },
      createdAt: "2026-10-09T10:00:00.000Z",
    };
    expect(describeEvent(event)).toBe("started on #7 Ship");
    expect(
      describeEvent({
        ...event,
        kind: "run.reported",
        data: { ...event.data, excerpt: "Found it" },
      }),
    ).toBe("reported on #7 Ship: Found it");
    expect(
      describeEvent({ ...event, kind: "run.handed_in", data: { ...event.data, label: "the fix" } }),
    ).toBe("handed in the fix on #7 Ship");
    expect(
      describeEvent({ ...event, kind: "run.ended", data: { ...event.data, status: "abandoned" } }),
    ).toBe("gave up on #7 Ship");
    expect(
      describeEvent({
        ...event,
        kind: "decision.raised",
        data: { question: "Which?", agent: "Claude Code" },
      }),
    ).toBe("asked: Which?");
    const html = renderToStaticMarkup(<EventFeed events={[event]} />);
    expect(html).toContain("as Claude Code");
    expect(html).toContain("started on #7 Ship");
  });

  it("marks a task an agent is at work on", () => {
    const html = renderToStaticMarkup(
      <Board tasks={[task({ openRuns: 1 })]} taskHref={href} onOpen={() => undefined} />,
    );
    expect(html).toContain("agent at work");
  });
});

describe("projects", () => {
  const project = (overrides: Partial<RestProject> = {}): RestProject => ({
    id: "0199c4d8-0000-7000-8000-000000000050",
    key: "web",
    name: "The web <app>",
    description: "What we ship.",
    visibility: "private",
    skillsAddress: "/gh/acme/skills",
    role: "owner",
    openDecisions: 2,
    openRuns: 1,
    createdAt: "2026-10-09T10:00:00.000Z",
    updatedAt: "2026-10-09T10:00:00.000Z",
    ...overrides,
  });

  it("lists what a person may see, each with what they are in it and what waits, as text", () => {
    const html = renderToStaticMarkup(
      <ProjectList
        projects={[
          project(),
          project({
            id: "0199c4d8-0000-7000-8000-000000000051",
            key: "ops",
            name: "Ops",
            role: "member",
            visibility: "workspace",
            description: "",
            openDecisions: 0,
            openRuns: 0,
          }),
        ]}
        projectHref={(item) => `/projects/${item.key}`}
        onOpen={() => undefined}
      />,
    );
    expect(html).toContain('href="/projects/web"');
    expect(html).toContain("The web &lt;app&gt;");
    expect(html).not.toContain("<app>");
    expect(html).toContain("What we ship.");
    expect(html).toContain("Owner");
    expect(html).toContain("Member");
    expect(html).toContain("Private");
    expect(html).toContain("2 decisions waiting");
    expect(html).toContain("1 agent at work");
    expect(
      renderToStaticMarkup(
        <ProjectList
          projects={[]}
          projectHref={() => "/"}
          onOpen={() => undefined}
          empty={<p>none</p>}
        />,
      ),
    ).toBe("<p>none</p>");
  });

  it("asks for a key and a name when making one, and keeps the key when changing one", () => {
    const making = renderToStaticMarkup(<ProjectForm onSubmit={() => undefined} />);
    expect(making).toContain("Make the project");
    expect(making).toContain("Key");
    expect(making).not.toMatch(/<input[^>]*maxLength="40"[^>]*disabled/);
    const changing = renderToStaticMarkup(
      <ProjectForm project={project()} onSubmit={() => undefined} />,
    );
    expect(changing).toContain(">Save<");
    expect(changing).toContain('value="web"');
    expect(changing).toMatch(/<input[^>]*maxLength="40"[^>]*disabled/);
    expect(changing).toContain("/gh/acme/skills");
    expect(keyOf("The Web App, v2!")).toBe("the-web-app-v2");
    expect(keyOf("---")).toBe("");
  });

  it("lists those in a project, and lets an owner add, change and remove them", () => {
    const members: RestMember[] = [
      { person: alice, role: "owner", addedAt: "2026-10-09T10:00:00.000Z" },
    ];
    const read = renderToStaticMarkup(
      <MemberList members={members} people={[alice, bob]} me={alice} />,
    );
    expect(read).toContain("Owner");
    expect(read).toContain("(you)");
    expect(read).not.toContain("<select");
    expect(read).not.toContain("Remove");
    const change = renderToStaticMarkup(
      <MemberList
        members={members}
        people={[alice, bob]}
        onAdd={() => undefined}
        onChangeRole={() => undefined}
        onRemove={() => undefined}
      />,
    );
    expect(change).toContain('aria-label="Add a member"');
    // Only those not listed yet are offered.
    expect(change).toContain(`<option value="${bob.id}">bob</option>`);
    expect(change).not.toContain(`<option value="${alice.id}"`);
    expect(change).toContain("Remove");
    const full = renderToStaticMarkup(
      <MemberList members={members} people={[alice]} onAdd={() => undefined} empty={<p>none</p>} />,
    );
    expect(full).not.toContain('aria-label="Add a member"');
    expect(
      renderToStaticMarkup(<MemberList members={[]} people={[]} empty={<p>none</p>} />),
    ).toContain("<p>none</p>");
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
