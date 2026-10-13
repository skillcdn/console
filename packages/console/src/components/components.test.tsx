import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  RestCategory,
  RestComment,
  RestConnectRequest,
  RestDecision,
  RestDocument,
  RestEvent,
  RestGoal,
  RestMember,
  RestPerson,
  RestProject,
  RestRun,
  RestTask,
  RestToken,
  RestWork,
} from "../api.js";
import { addDays, firstDayOfWeek, weekOf } from "../dates.js";
import { KOREAN, LanguageContext } from "../i18n/index.js";
import { Board, BoardFilters, byDue, filterTasks } from "./board.js";
import {
  Calendar,
  placeTip,
  TaskTip,
  Week,
  Workload,
  weekSegments,
  workloadOf,
} from "./calendar.js";
import { CategoryList } from "./categories.js";
import { CommentCard, CommentForm, TaskThread, threadOf } from "./comments.js";
import { ConnectApproval, ConnectCodeForm, ConnectWords } from "./connect.js";
import { DecisionCard, DecisionList, DecisionLog } from "./decision-list.js";
import { DocumentForm, DocumentList, DocumentView, FolderView } from "./documents.js";
import { describeEvent, EventFeed } from "./event-feed.js";
import { GoalForm, GoalList, GoalView } from "./goals.js";
import { Markdown } from "./markdown.js";
import { ListingForm, PeopleList } from "./people.js";
import { keyOf, MemberList, ProjectForm, ProjectList, ProjectMark } from "./projects.js";
import { RulesForm, RulesView } from "./rules.js";
import { RunList } from "./runs.js";
import { Shell } from "./shell.js";
import { SignIn } from "./sign-in.js";
import { SkillList } from "./skills.js";
import { TaskList } from "./task-list.js";
import { TaskView } from "./task-view.js";
import { NewToken, TokenForm, TokenList } from "./tokens.js";
import { Avatar, PersonChip, personName } from "./ui.js";
import { WorkList } from "./work.js";

const alice: RestPerson = {
  id: "0199c4d8-0000-7000-8000-000000000001",
  login: "alice",
  name: "Alice Example",
  avatar: "https://avatars.example/alice.png",
  role: "admin",
  status: "active",
  source: "listed",
  deactivatedAt: null,
};
const bob: RestPerson = {
  id: "0199c4d8-0000-7000-8000-000000000002",
  login: "bob",
  name: null,
  avatar: null,
  role: "member",
  status: "active",
  source: "listed",
  deactivatedAt: null,
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
  category: null,
  goalId: null,
  startsOn: null,
  dueOn: null,
  startedAt: null,
  doneAt: null,
  links: [],
  openDecisions: 1,
  openRuns: 0,
  createdAt: "2026-10-09T10:00:00.000Z",
  updatedAt: "2026-10-09T11:00:00.000Z",
  ...overrides,
});

const engineering: RestCategory = {
  key: "engineering",
  name: "Engineering",
  color: "blue",
  createdAt: "2026-10-09T10:00:00.000Z",
  updatedAt: "2026-10-09T10:00:00.000Z",
};

const goal = (overrides: Partial<RestGoal> = {}): RestGoal => ({
  id: "0199c4d8-0000-7000-8000-000000000030",
  title: "Ship v1 <b>now</b>",
  body: "",
  state: "active",
  dueOn: "2026-11-15",
  createdBy: alice,
  taskCounts: { idea: 1, ready: 0, in_progress: 1, in_review: 0, done: 2, dropped: 1 },
  createdAt: "2026-10-09T10:00:00.000Z",
  updatedAt: "2026-10-09T10:00:00.000Z",
  ...overrides,
});

/** The day the tests count from: a Sunday in October 2026. */
const TODAY = "2026-10-11";

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

describe("the language", () => {
  it("is the one above a component, and English where there is none", () => {
    const korean = renderToStaticMarkup(
      <LanguageContext.Provider value={KOREAN}>
        <Board tasks={[task()]} taskHref={href} onOpen={() => undefined} />
      </LanguageContext.Provider>,
    );
    expect(korean).toContain('aria-label="아이디어"');
    expect(korean).toContain("결정 1건");
    expect(korean).not.toContain("Idea");
    const english = renderToStaticMarkup(
      <Board tasks={[task()]} taskHref={href} onOpen={() => undefined} />,
    );
    expect(english).toContain('aria-label="Idea"');
    expect(
      describeEvent(
        {
          id: 1,
          kind: "task.moved",
          actor: bob,
          agent: null,
          projectId: null,
          taskId: null,
          decisionId: null,
          runId: null,
          documentId: null,
          goalId: null,
          data: { number: 7, title: "Ship", from: "ready", to: "in_progress" },
          createdAt: "2026-10-09T10:00:00.000Z",
        },
        KOREAN.messages,
      ),
    ).toBe("#7 Ship을(를) 준비됨에서 진행 중(으)로 옮겼습니다");
  });
});

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
            goalId: null,
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
    // The facts stand beside the text, in a column of their own.
    expect(html).toContain('<aside class="sc-task-aside" aria-label="At a glance">');
    // Everything that happened to it, with the agent a person acted through.
    expect(html).toContain('aria-label="What happened"');
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
  it("list the waiting ones as cards with their options, and the answered ones as the record, a row each", () => {
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
        decisionHref={(item) => `/projects/web/decisions/${item.id}`}
        onAnswer={() => undefined}
      />,
    );
    expect(html).toContain('aria-label="Waiting"');
    expect(html).toContain('type="radio"');
    // The record: what was asked, what was chosen, by whom, in a row that leads to the page.
    expect(html).toContain('aria-label="The record"');
    expect(html).toContain(`href="/projects/web/decisions/${answered.id}"`);
    expect(html).toContain("The second");
    expect(html).toContain("bob");
    expect(html).not.toContain("Shorter.");
    expect(html).toContain("#7");
    const log = renderToStaticMarkup(<DecisionLog decisions={[answered]} />);
    expect(log).toContain("Name?");
    expect(log).not.toContain("<a ");
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
    goalId: null,
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

  it("shows a picture named by a file's name where the text puts it, when told where the file is", () => {
    const source = "Before ![the board](board.png) and ![elsewhere](other.png).";
    const html = renderToStaticMarkup(
      <Markdown
        source={source}
        fileSrc={(name) => (name === "board.png" ? "/api/v1/projects/web/files/f1" : undefined)}
      />,
    );
    expect(html).toContain('<img src="/api/v1/projects/web/files/f1" alt="the board"');
    expect(html).toContain('<span class="sc-prose-image-text">elsewhere</span>');
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
    expect(html).toContain('<aside class="sc-task-aside" aria-label="About this page">');
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
        languages={[
          { tag: "en", label: "English", current: true },
          { tag: "ko", label: "한국어", current: false },
        ]}
        onLanguage={() => undefined}
        person={alice}
        live={true}
        onNavigate={() => undefined}
        onSignOut={() => undefined}
      >
        <p>content</p>
      </Shell>,
    );
    expect(html).toContain("Acme");
    expect(html).not.toContain("sc-brand-symbol");
    const branded = renderToStaticMarkup(
      <Shell
        title="Acme"
        brand={{ symbol: "/brand/symbol.svg" }}
        nav={[]}
        person={undefined}
        onNavigate={() => undefined}
      >
        <p>content</p>
      </Shell>,
    );
    expect(branded).toContain('class="sc-brand-symbol" src="/brand/symbol.svg"');
    expect(html).toContain('class="sc-tab sc-tab-current"');
    expect(html).toContain('class="sc-menu"');
    expect(html).toContain('lang="ko"');
    expect(html).toContain("한국어");
    expect(html).toContain('aria-pressed="true"');
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
    const marked = renderToStaticMarkup(
      <SignIn
        title="Acme"
        brand={{ wordmark: "/brand/wordmark.svg" }}
        providers={[]}
        returnTo="/"
      />,
    );
    expect(marked).toContain('class="sc-sign-in-wordmark" src="/brand/wordmark.svg"');
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
    client: null,
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
            client: "0.1.18",
          },
          {
            ...token,
            id: "0199c4d8-0000-7000-8000-000000000032",
            name: "forever",
            expiresAt: null,
            client: "0.1.17",
          },
        ]}
        consoleVersion="0.1.18"
        onRevoke={() => undefined}
      />,
    );
    expect(html).toContain("Claude Code &lt;on&gt; the laptop");
    expect(html).toContain("Not active yet");
    expect(html).toContain("Last active");
    expect(html).toContain("Good until");
    expect(html).toContain("Does not expire");
    // Which version of the command each agent runs, and whether the console still takes it.
    expect(html).toContain("console 0.1.18");
    expect(html).toContain("console 0.1.17");
    expect(html).toContain("must be updated");
    expect(html.split("must be updated")).toHaveLength(2);
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
    expect(words).toContain(
      "npm install -g @skillcdn/console\nconsole login --url https://console.test</pre>",
    );
    expect(words).toContain("Tell your agent");
    expect(words).toContain(">Copy<");
    expect(words).not.toContain("Open the address");
  });
});

describe("people", () => {
  it("lists everyone with what they are, and lets an administrator change it", () => {
    const read = renderToStaticMarkup(<PeopleList people={[alice, bob]} me={bob} />);
    expect(read).toContain("Administrator");
    const seen = renderToStaticMarkup(
      <PeopleList
        people={[alice]}
        workHref={(person) => `/people/${person.id}/work`}
        agentsHref={(person) => `/people/${person.id}/agents`}
      />,
    );
    expect(seen).toContain(`href="/people/${alice.id}/work"`);
    expect(seen).toContain(`href="/people/${alice.id}/agents"`);
    expect(read).not.toContain("/agents");
    expect(read).not.toContain("/work");
    expect(read).toContain("Member");
    expect(read).toContain("(you)");
    expect(read).not.toContain("<select");
    const change = renderToStaticMarkup(
      <PeopleList people={[alice, bob]} me={alice} onChangeRole={() => undefined} />,
    );
    expect(change.match(/<select/g)).toHaveLength(2);
    expect(change).toContain('value="admin"');
  });

  it("keeps those out apart, with the way back in, and shows the logins let in with the way out", () => {
    const carol: RestPerson = {
      ...bob,
      id: "0199c4d8-0000-7000-8000-000000000003",
      login: "carol",
      status: "deactivated",
      deactivatedAt: "2026-10-12T09:00:00.000Z",
    };
    const dave: RestPerson = {
      ...carol,
      id: "0199c4d8-0000-7000-8000-000000000004",
      login: "dave",
      source: "organization",
    };
    const dana = {
      id: "0199c4d8-0000-7000-8000-000000000077",
      host: "gh" as const,
      login: "dana",
      createdAt: "2026-10-12T09:00:00.000Z",
    };
    const read = renderToStaticMarkup(
      <PeopleList people={[alice, carol, dave]} listed={[dana]} me={bob} />,
    );
    expect(read).toContain("Added, not signed in yet");
    expect(read).toContain("dana");
    expect(read).toContain("at GitHub");
    expect(read).toContain("Deactivated");
    expect(read).toContain("Left the organization");
    expect(read).not.toContain("<button");
    const kept = renderToStaticMarkup(
      <PeopleList
        people={[alice, carol, dave]}
        listed={[dana]}
        me={alice}
        onChangeStatus={() => undefined}
        onUnlist={() => undefined}
      />,
    );
    // Carol may be taken back in; Dave comes and goes with the organization; Alice is not her own to take out.
    expect(kept.match(/Reactivate/g)).toHaveLength(1);
    expect(kept).not.toContain(">Deactivate<");
    expect(kept).toContain(">Remove<");
    const others = renderToStaticMarkup(
      <PeopleList people={[alice, bob]} me={alice} onChangeStatus={() => undefined} />,
    );
    expect(others.match(/>Deactivate</g)).toHaveLength(1);
    // The organization that says who is in, and when it was last read.
    const unread = renderToStaticMarkup(
      <PeopleList people={[alice]} organization={{ host: "gh", name: "acme", syncedAt: null }} />,
    );
    expect(unread).toContain("The organization acme at GitHub says who is in.");
    expect(unread).toContain("Not read yet.");
    const synced = renderToStaticMarkup(
      <PeopleList
        people={[alice]}
        organization={{ host: "gh", name: "acme", syncedAt: "2026-10-12T09:00:00.000Z" }}
      />,
    );
    expect(synced).toContain("Last read");
    expect(synced).toContain("<time");
  });

  it("lets someone in by a login spelled as its host spells one", () => {
    const both = renderToStaticMarkup(
      <ListingForm
        providers={[
          { key: "gh", label: "GitHub" },
          { key: "google", label: "Google" },
        ]}
        onSubmit={() => undefined}
      />,
    );
    expect(both).toContain("Login, or address");
    expect(both).toContain("<select");
    expect(both).toContain("disabled");
    const one = renderToStaticMarkup(
      <ListingForm providers={[{ key: "gh", label: "GitHub" }]} onSubmit={() => undefined} />,
    );
    expect(one).not.toContain("<select");
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
      goalId: null,
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
    lastHeardAt: "2026-10-09T10:05:00.000Z",
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
      goalId: null,
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

  it("says nothing on a card of an agent at work, since the board cannot know", () => {
    const html = renderToStaticMarkup(
      <Board tasks={[task({ openRuns: 1 })]} taskHref={href} onOpen={() => undefined} />,
    );
    expect(html).not.toContain("agent");
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
    color: null,
    symbol: null,
    icon: null,
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
    // What is not private says so, in so many words: a project is never open by accident.
    expect(html).toContain("Open to everyone");
    expect(html).toContain("2 decisions waiting");
    expect(html).not.toContain("at work");
    // Each with its mark: the first letter of its name on a colour from its key, unless it names its own.
    expect(html).toContain('class="sc-mark sc-mark-md sc-category-');
    expect(html).toContain(">T</span>");
    const marked = renderToStaticMarkup(
      <ProjectMark project={project({ color: "teal", symbol: "W2" })} size="lg" />,
    );
    expect(marked).toContain("sc-mark-lg sc-category-teal");
    expect(marked).toContain(">W2</span>");
    const chosen = renderToStaticMarkup(<ProjectMark project={project()} />);
    expect(chosen).toBe(renderToStaticMarkup(<ProjectMark project={project()} />));
    expect(chosen).not.toContain("sc-category-gray");
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
        workHref={(member) => `/people/${member.person.id}/work`}
      />,
    );
    expect(change).toContain('aria-label="Add a member"');
    expect(change).toContain(`href="/people/${alice.id}/work"`);
    expect(read).not.toContain("/work");
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

describe("the schedule on the board", () => {
  it("says on a card what is due and whose agent is at work, and nothing it need not", () => {
    const run: RestRun = {
      id: "0199c4d8-0000-7000-8000-000000000040",
      taskId: task().id,
      taskNumber: 7,
      person: alice,
      agent: "Claude Code",
      status: "running",
      startedAt: "2026-10-11T09:00:00.000Z",
      endedAt: null,
      lastHeardAt: "2026-10-11T09:00:00.000Z",
      summary: null,
      reports: [],
      artifacts: [],
      waitingFor: null,
    };
    const html = renderToStaticMarkup(
      <Board
        tasks={[
          task({
            category: engineering,
            dueOn: "2026-10-09",
            openRuns: 1,
            links: [{ url: "https://example.com", label: null }],
          }),
        ]}
        today={TODAY}
        taskHref={href}
        onOpen={() => undefined}
      />,
    );
    expect(html).toContain("sc-badge-category sc-category-blue");
    expect(html).toContain("Engineering");
    expect(html).toContain("2 days overdue");
    expect(html).not.toContain(run.agent);
    expect(html).not.toContain("agent at work");
    expect(html).not.toContain("1 link");
    // Due today, tomorrow, within the week, and later: each said as a person reads it.
    const words = (dueOn: string, state: RestTask["state"] = "ready") =>
      renderToStaticMarkup(
        <Board
          tasks={[task({ dueOn, state, openDecisions: 0 })]}
          today={TODAY}
          taskHref={href}
          onOpen={() => undefined}
        />,
      );
    expect(words("2026-10-11")).toContain("Due today");
    expect(words("2026-10-12")).toContain("Due tomorrow");
    expect(words("2026-10-15")).toContain("Due in 4 days");
    expect(words("2026-11-20")).toContain("Due Nov 20");
    expect(words("2026-10-01", "done")).toContain("Due Oct 1");
    expect(words("2026-10-01", "done")).not.toContain("overdue");
  });

  it("reads a column soonest due first, and narrows the board by category, goal, person and one's own", () => {
    const a = task({ id: "0199c4d8-0000-7000-8000-000000000011", number: 1, dueOn: null });
    const b = task({ id: "0199c4d8-0000-7000-8000-000000000012", number: 2, dueOn: "2026-10-20" });
    const c = task({ id: "0199c4d8-0000-7000-8000-000000000013", number: 3, dueOn: "2026-10-12" });
    const d = task({ id: "0199c4d8-0000-7000-8000-000000000014", number: 4, dueOn: null });
    expect([a, b, c, d].sort(byDue).map((item) => item.number)).toEqual([3, 2, 4, 1]);
    const mine = task({
      id: "0199c4d8-0000-7000-8000-000000000015",
      number: 5,
      assignee: alice,
      category: engineering,
      goalId: goal().id,
    });
    const all = [a, mine];
    expect(filterTasks(all, {}).length).toBe(2);
    expect(filterTasks(all, { category: "engineering" })).toEqual([mine]);
    expect(filterTasks(all, { category: "" })).toEqual([a]);
    expect(filterTasks(all, { goal: goal().id })).toEqual([mine]);
    expect(filterTasks(all, { goal: "" })).toEqual([a]);
    expect(filterTasks(all, { person: alice.id })).toEqual([mine]);
    expect(filterTasks(all, { mine: true }, alice)).toEqual([mine]);
    expect(filterTasks(all, { mine: true })).toEqual([]);
    const html = renderToStaticMarkup(
      <BoardFilters
        filter={{ category: "engineering" }}
        categories={[engineering]}
        goals={[
          goal(),
          goal({ id: "0199c4d8-0000-7000-8000-000000000031", state: "dropped", title: "Gone" }),
        ]}
        people={[alice, bob]}
        me={alice}
        shown={1}
        total={2}
        onChange={() => undefined}
      />,
    );
    expect(html).toContain('aria-label="Narrow the board"');
    expect(html).toContain("1 of 2 tasks");
    expect(html).toContain("Show everything");
    expect(html).toContain("Ship v1");
    expect(html).not.toContain("Gone");
    expect(html).toContain("Mine");
  });

  it("lists tasks as rows with the project named when asked, and says the plan on a task's page", () => {
    const rows = renderToStaticMarkup(
      <TaskList
        tasks={[task({ category: engineering, dueOn: "2026-10-09", openRuns: 1 })]}
        taskHref={href}
        today={TODAY}
        showState
        projectOf={() => "The web app"}
      />,
    );
    expect(rows).toContain("The web app");
    expect(rows).toContain("Ready");
    expect(rows).toContain("2 days overdue");
    expect(rows).not.toContain("agent at work");
    // A long list shows a page at a time, and says how many more there are.
    const many = Array.from({ length: 60 }, (_, index) =>
      task({
        id: `0199c4d8-0000-7000-8000-0000000001${String(index).padStart(2, "0")}`,
        number: index + 100,
      }),
    );
    const paged = renderToStaticMarkup(<TaskList tasks={many} taskHref={href} />);
    expect(paged).toContain("#149");
    expect(paged).not.toContain("#150");
    expect(paged).toContain("Show 10 more of 10");
    const view = renderToStaticMarkup(
      <TaskView
        task={task({
          category: engineering,
          goalId: goal().id,
          startsOn: "2026-10-20",
          dueOn: "2026-10-24",
          startedAt: "2026-10-21T09:00:00.000Z",
          doneAt: null,
        })}
        people={[alice, bob]}
        tasks={[task()]}
        decisions={[]}
        goals={[goal()]}
        goalHref={(id) => `/projects/web/roadmap/${id}`}
        taskHref={href}
        today={TODAY}
        onChange={() => undefined}
        onMove={() => undefined}
        onRaiseDecision={() => undefined}
        onAnswer={() => undefined}
      />,
    );
    expect(view).toContain("Oct 20 to Oct 24");
    expect(view).toContain(`href="/projects/web/roadmap/${goal().id}"`);
    expect(view).toContain("Ship v1");
    expect(view).toContain("Started");
    expect(view).not.toContain("<dt>Done</dt>");
    const bare = renderToStaticMarkup(
      <TaskView
        task={task()}
        people={[alice, bob]}
        tasks={[task()]}
        decisions={[]}
        taskHref={href}
        onChange={() => undefined}
        onMove={() => undefined}
        onRaiseDecision={() => undefined}
        onAnswer={() => undefined}
      />,
    );
    expect(bare).not.toContain("<dt>Plan</dt>");
    expect(bare).not.toContain("<dt>Category</dt>");
  });
});

describe("the calendar", () => {
  it("lays the month out with each task on its day, late ones marked, and the neighbours' days greyed", () => {
    const html = renderToStaticMarkup(
      <Calendar
        tasks={[
          task({ dueOn: "2026-10-09", title: "Late one" }),
          task({
            id: "0199c4d8-0000-7000-8000-000000000011",
            number: 8,
            title: "Planned one",
            startsOn: "2026-10-20",
            dueOn: "2026-10-24",
            category: engineering,
          }),
          task({
            id: "0199c4d8-0000-7000-8000-000000000012",
            number: 9,
            title: "Done one",
            dueOn: "2026-10-05",
            state: "done",
          }),
        ]}
        month="2026-10"
        today={TODAY}
        taskHref={href}
        monthHref={(month) => `/projects/web/calendar?month=${month}`}
      />,
    );
    expect(html).toContain("October 2026");
    expect(html).toContain('href="/projects/web/calendar?month=2026-09"');
    expect(html).toContain('href="/projects/web/calendar?month=2026-11"');
    expect(html).toContain("sc-calendar-cell-today");
    expect(html).toContain("sc-calendar-cell-outside");
    expect(html).toContain("sc-calendar-late");
    expect(html).toContain("sc-calendar-over");
    expect(html).toContain("sc-category-blue");
    expect(html).toContain("Planned one");
    // Not the browser's tip: the task under the pointer is shown in full by the calendar, and only then.
    expect(html).not.toContain('title="#');
    expect(html).not.toContain("data-tip");
    expect(html).not.toContain("sc-task-tip");
    expect(html).not.toContain("Nothing is due this month");
    const empty = renderToStaticMarkup(
      <Calendar
        tasks={[]}
        month="2026-12"
        today={TODAY}
        taskHref={href}
        monthHref={(month) => month}
      />,
    );
    expect(empty).toContain("Nothing is due this month");
  });

  it("says who has what, with the late and the soon due counted, and nobody's last", () => {
    const tasks = [
      task({ assignee: bob, dueOn: "2026-10-09", state: "in_progress" }),
      task({ id: "0199c4d8-0000-7000-8000-000000000011", assignee: bob, dueOn: "2026-10-15" }),
      task({ id: "0199c4d8-0000-7000-8000-000000000012", assignee: null, dueOn: null }),
      task({ id: "0199c4d8-0000-7000-8000-000000000013", assignee: alice, state: "done" }),
      task({ id: "0199c4d8-0000-7000-8000-000000000014", assignee: alice, dueOn: "2026-10-30" }),
    ];
    const rows = workloadOf(tasks, TODAY);
    expect(rows.map((row) => row.person?.login ?? null)).toEqual(["alice", "bob", null]);
    expect(rows[1]).toMatchObject({ open: 2, inProgress: 1, dueSoon: 1, overdue: 1 });
    expect(rows[0]).toMatchObject({ open: 1, inProgress: 0, dueSoon: 0, overdue: 0 });
    expect(rows[2]).toMatchObject({ open: 1 });
    const html = renderToStaticMarkup(
      <Workload
        tasks={tasks}
        today={TODAY}
        personHref={(person) => `/board?person=${person?.id ?? ""}`}
      />,
    );
    expect(html).toContain('aria-label="Who has what"');
    expect(html).toContain("sc-workload-late");
    expect(html).toContain("Nobody&#x27;s yet");
    expect(html).toContain(`href="/board?person=${bob.id}"`);
    expect(renderToStaticMarkup(<Workload tasks={[]} today={TODAY} />)).toBe("");
  });
});

describe("the roadmap", () => {
  it("lists the goals with how far each is, as text and never as HTML", () => {
    const html = renderToStaticMarkup(
      <GoalList
        goals={[
          goal(),
          goal({ id: "0199c4d8-0000-7000-8000-000000000031", state: "done", title: "Reached" }),
        ]}
        goalHref={(item) => `/projects/web/roadmap/${item.id}`}
        today={TODAY}
      />,
    );
    expect(html).toContain("Ship v1 &lt;b&gt;now&lt;/b&gt;");
    expect(html).not.toContain("<b>now</b>");
    expect(html).toContain("2 of 4 tasks done");
    expect(html).toContain("1 in progress");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain("Active");
    expect(html).toContain("Reached");
    expect(html).toContain("Due Nov 15");
    expect(html).toContain("sc-goal-done");
    expect(
      renderToStaticMarkup(<GoalList goals={[]} goalHref={() => "#"} empty={<p>none</p>} />),
    ).toBe("<p>none</p>");
  });

  it("shows one goal with its tasks by state, the way to change it, and the form to set one", () => {
    const html = renderToStaticMarkup(
      <GoalView
        goal={goal({ body: "See [the plan](plan)." })}
        tasks={[
          task({ goalId: goal().id, state: "done", title: "Defined" }),
          task({ id: "0199c4d8-0000-7000-8000-000000000011", goalId: goal().id, title: "Pending" }),
          task({ id: "0199c4d8-0000-7000-8000-000000000012", title: "Elsewhere" }),
        ]}
        taskHref={href}
        docHref={(path) => `/projects/web/docs/${path}`}
        today={TODAY}
        editHref="/projects/web/roadmap/x?edit"
        onMove={() => undefined}
      />,
    );
    expect(html).toContain('href="/projects/web/docs/plan"');
    expect(html).toContain("Defined");
    expect(html).toContain("Pending");
    expect(html).not.toContain("Elsewhere");
    expect(html).toContain('href="/projects/web/roadmap/x?edit"');
    expect(html).toContain("<select");
    expect(html).toContain("Set by");
    const readOnly = renderToStaticMarkup(
      <GoalView goal={goal({ dueOn: null })} tasks={[]} taskHref={href} today={TODAY} />,
    );
    expect(readOnly).not.toContain("<select");
    expect(readOnly).toContain("No target day");
    expect(readOnly).toContain("No task works towards it yet.");
    const form = renderToStaticMarkup(<GoalForm onSubmit={() => undefined} />);
    expect(form).toContain('type="date"');
    expect(form).toContain("Set the goal");
    expect(form).toContain("Planned");
    const edit = renderToStaticMarkup(<GoalForm goal={goal()} onSubmit={() => undefined} />);
    expect(edit).toContain('value="2026-11-15"');
    expect(edit).toContain("Save");
  });
});

describe("the categories", () => {
  it("list each in its colour, and give an administrator the ways to rename, recolour, add and remove", () => {
    const readOnly = renderToStaticMarkup(<CategoryList categories={[engineering]} />);
    expect(readOnly).toContain("Engineering");
    expect(readOnly).toContain("sc-category-blue");
    expect(readOnly).not.toContain("<form");
    const html = renderToStaticMarkup(
      <CategoryList
        categories={[engineering]}
        onAdd={() => undefined}
        onChange={() => undefined}
        onRemove={() => undefined}
      />,
    );
    expect(html).toContain('aria-label="Add a category"');
    expect(html).toContain('value="Engineering"');
    expect(html).toContain("Remove");
    expect(html).toContain("Teal");
    expect(html).toContain('pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?"');
  });
});

describe("a person's work", () => {
  it("groups what is on the plate by when it is due, names the project, and lists the decisions waiting", () => {
    const work: RestWork = {
      tasks: [
        {
          project: { key: "web", name: "The web app", color: null, symbol: null, icon: null },
          task: task({ dueOn: "2026-10-09", title: "Late" }),
        },
        {
          project: { key: "web", name: "The web app", color: null, symbol: null, icon: null },
          task: task({
            id: "0199c4d8-0000-7000-8000-000000000011",
            dueOn: "2026-10-14",
            title: "Soon",
          }),
        },
        {
          project: { key: "docs", name: "The docs", color: "green", symbol: "D", icon: null },
          task: task({
            id: "0199c4d8-0000-7000-8000-000000000012",
            dueOn: "2026-11-30",
            title: "Far",
          }),
        },
        {
          project: { key: "docs", name: "The docs", color: "green", symbol: "D", icon: null },
          task: task({ id: "0199c4d8-0000-7000-8000-000000000013", dueOn: null, title: "Someday" }),
        },
        {
          project: { key: "docs", name: "The docs", color: "green", symbol: "D", icon: null },
          task: task({
            id: "0199c4d8-0000-7000-8000-000000000014",
            number: 9,
            dueOn: TODAY,
            title: "On the day",
          }),
        },
      ],
      decisions: [
        {
          project: { key: "web", name: "The web app", color: null, symbol: null, icon: null },
          decision: decision(),
        },
      ],
    };
    const html = renderToStaticMarkup(
      <WorkList
        work={work}
        today={TODAY}
        taskHref={(key, item) => `/projects/${key}/tasks/${item.number}`}
        decisionHref={(key, id) => `/projects/${key}/decisions/${id}`}
        weekHref={(day) => `/work?week=${day}`}
      />,
    );
    for (const section of ["Overdue", "Due this week", "Later", "No day set"]) {
      expect(html).toContain(`aria-label="${section}"`);
    }
    expect(html).toContain("The docs");
    expect(html).toContain("sc-mark-sm sc-category-green");
    expect(html).toContain('href="/projects/docs/tasks/7"');
    expect(html).toContain(`href="/projects/web/decisions/${decision().id}"`);
    expect(html).toContain("Which one?");
    // The week at the top: today's, with the project's mark before the task on its day.
    const first = weekOf(TODAY, firstDayOfWeek("en"))[0] ?? "";
    expect(html).toContain('aria-label="The week"');
    expect(html).toContain("sc-calendar-cell-today");
    expect(html).toContain(`href="/work?week=${addDays(first, -7)}"`);
    expect(html).toContain(`href="/work?week=${addDays(first, 7)}"`);
    expect(html).toMatch(
      /class="sc-calendar-task[^"]*"[^>]*><span class="sc-mark sc-mark-sm sc-category-green"[^>]*>D<\/span><span class="sc-calendar-task-title">On the day/,
    );
    const quiet = renderToStaticMarkup(
      <WorkList
        work={{ tasks: [], decisions: [] }}
        today={TODAY}
        taskHref={() => "#"}
        decisionHref={() => "#"}
        weekHref={(day) => `/work?week=${day}`}
      />,
    );
    expect(quiet).toContain("No decision waits.");
    expect(quiet).toContain("Nothing is planned this week.");
    expect(quiet).not.toContain('aria-label="Overdue"');
    // Another person's plate carries no decisions, and says nothing of them.
    const theirs = renderToStaticMarkup(
      <WorkList
        work={{ tasks: work.tasks }}
        today={TODAY}
        taskHref={(key, item) => `/projects/${key}/tasks/${item.number}`}
        decisionHref={() => "#"}
        weekHref={(day) => `/people/x/work?week=${day}`}
      />,
    );
    expect(theirs).toContain('aria-label="Overdue"');
    expect(theirs).not.toContain('aria-label="Decisions waiting for a person"');
    expect(theirs).not.toContain("No decision waits.");
    expect(quiet).toContain('aria-label="Decisions waiting for a person"');
  });

  it("shows one week on its own, the weeks around a step away, in the person's language", () => {
    const first = weekOf("2026-10-14", firstDayOfWeek("en"))[0] ?? "";
    const html = renderToStaticMarkup(
      <Week
        tasks={[
          task({ dueOn: "2026-10-14", title: "On the day" }),
          task({
            id: "0199c4d8-0000-7000-8000-000000000011",
            number: 8,
            title: "Across",
            startsOn: "2026-10-13",
            dueOn: "2026-10-16",
            category: engineering,
          }),
          task({ id: "0199c4d8-0000-7000-8000-000000000012", number: 9, title: "Someday" }),
        ]}
        day="2026-10-14"
        today={TODAY}
        taskHref={href}
        weekHref={(day) => `/work?week=${day}`}
        markOf={(item) => <span className="sc-mark">{item.number}</span>}
      />,
    );
    expect(html).toContain('aria-label="The week"');
    expect(html).toContain("Oct");
    expect(html).toContain("2026");
    expect(html).toContain(`href="/work?week=${addDays(first, -7)}"`);
    expect(html).toContain(`href="/work?week=${addDays(first, 7)}"`);
    expect(html).toContain(`href="/work?week=${TODAY}"`);
    expect(html).toContain("This week");
    expect(html).toContain("sc-calendar-bar sc-category-blue sc-calendar-bar-begins");
    expect(html).toContain("sc-calendar-bar-ends");
    expect(html).toContain('<span class="sc-mark">8</span>');
    expect(html).toContain("On the day");
    expect(html).not.toContain("sc-calendar-dot");
    // One person's week says nothing about who has the work: it is theirs.
    expect(html).not.toContain("sc-avatar");
    expect(html).not.toContain("Someday");
    expect(html).not.toContain("Nothing is planned");
    const korean = renderToStaticMarkup(
      <LanguageContext.Provider value={KOREAN}>
        <Week tasks={[]} today={TODAY} taskHref={href} weekHref={(day) => day} />
      </LanguageContext.Provider>,
    );
    expect(korean).toContain("이 주에 잡힌 작업이 없습니다.");
    expect(korean).toContain("sc-calendar-cell-today");
    expect(korean).toContain("10월");
  });
});

describe("a task planned across days", () => {
  it("lies across its days as a bar in a lane of its own, cut to each week, and the legend says what the marks mean", () => {
    const week = Array.from({ length: 7 }, (_, index) => ({
      day: `2026-10-${String(11 + index).padStart(2, "0")}`,
      inMonth: true,
    }));
    const a = task({
      id: "0199c4d8-0000-7000-8000-000000000011",
      number: 1,
      startsOn: "2026-10-09",
      dueOn: "2026-10-13",
    });
    const b = task({
      id: "0199c4d8-0000-7000-8000-000000000012",
      number: 2,
      startsOn: "2026-10-12",
      dueOn: "2026-10-20",
    });
    const c = task({
      id: "0199c4d8-0000-7000-8000-000000000013",
      number: 3,
      startsOn: "2026-10-15",
      dueOn: "2026-10-16",
    });
    const single = task({
      id: "0199c4d8-0000-7000-8000-000000000014",
      number: 4,
      startsOn: "2026-10-12",
      dueOn: "2026-10-12",
    });
    const outside = task({
      id: "0199c4d8-0000-7000-8000-000000000015",
      number: 5,
      startsOn: "2026-10-20",
      dueOn: "2026-10-22",
    });
    const segments = weekSegments(week, [a, b, c, single, outside]);
    expect(
      segments.map((segment) => [
        segment.task.number,
        segment.from,
        segment.to,
        segment.lane,
        segment.begins,
        segment.ends,
      ]),
    ).toEqual([
      [1, 0, 2, 0, false, true],
      [2, 1, 6, 1, true, false],
      [3, 4, 5, 0, true, true],
    ]);
    const html = renderToStaticMarkup(
      <Calendar
        tasks={[
          b,
          single,
          task({
            id: "0199c4d8-0000-7000-8000-000000000016",
            number: 6,
            startsOn: "2026-10-14",
            dueOn: null,
            title: "Begins",
          }),
        ]}
        month="2026-10"
        today={TODAY}
        categories={[engineering]}
        taskHref={href}
        monthHref={(month) => month}
      />,
    );
    expect(html).toContain("sc-calendar-bar sc-category-gray sc-calendar-bar-begins");
    expect(html).toContain("sc-calendar-bar-ends");
    expect(html).toContain("sc-calendar-lane");
    expect(html).toContain('aria-label="Category colours"');
    expect(html).toContain("Engineering");
    expect(html).not.toContain("Planned from");
    // A task with a start alone sits on that day as any task on its day: a dot, and never late.
    expect(html).not.toContain("sc-calendar-task-start");
    expect(html).not.toContain("Starts that day");
    expect(html.match(/sc-calendar-dot/g)).toHaveLength(3);
    expect(html).not.toContain("sc-calendar-late");
    // On a project's calendar the person who has a task stands before its title.
    expect(html).not.toContain("data-tip");
    expect(html).toContain(
      '<span class="sc-avatar sc-avatar-initial sc-avatar-xs" aria-hidden="true">B</span>',
    );
    const nobody = renderToStaticMarkup(
      <Calendar
        tasks={[task({ dueOn: "2026-10-14", assignee: null })]}
        month="2026-10"
        today={TODAY}
        taskHref={href}
        monthHref={(month) => month}
      />,
    );
    expect(nobody).not.toContain("sc-avatar");
    expect(nobody).not.toContain("data-tip");
  });

  it("shows the task under the pointer in full, on the side of the item with more room", () => {
    // Near the top of the window the card goes below the item; near the bottom, above it; at the
    // right edge it moves left to stay within the window, and never right.
    expect(placeTip({ top: 40, bottom: 60, left: 100 }, { width: 1400, height: 1000 })).toEqual({
      side: "below",
      shift: 0,
    });
    expect(placeTip({ top: 900, bottom: 920, left: 1300 }, { width: 1400, height: 1000 })).toEqual({
      side: "above",
      shift: -228,
    });
    expect(placeTip({ top: 500, bottom: 520, left: 2 }, { width: 1400, height: 1000 })).toEqual({
      side: "above",
      shift: 0,
    });
    const html = renderToStaticMarkup(
      <TaskTip
        task={task({
          category: engineering,
          goalId: goal().id,
          startsOn: "2026-10-20",
          dueOn: "2026-10-24",
          startedAt: "2026-10-20T09:00:00.000Z",
        })}
        goals={[goal()]}
        place={{ side: "above", shift: -40 }}
      />,
    );
    expect(html).toContain('class="sc-task-tip sc-task-tip-above"');
    expect(html).toContain('style="left:-40px"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("#7 Ship the release &lt;b&gt;now&lt;/b&gt;");
    expect(html).toContain("<dt>State</dt>");
    expect(html).toContain("Ready");
    expect(html).toContain("<dt>Priority</dt>");
    expect(html).toContain("High");
    expect(html).toContain("<dt>Category</dt>");
    expect(html).toContain("Engineering");
    expect(html).toContain("<dt>Goal</dt>");
    expect(html).toContain("Ship v1 &lt;b&gt;now&lt;/b&gt;");
    expect(html).toContain("<dt>Owner</dt>");
    expect(html).toContain("Alice Example");
    expect(html).toContain("<dt>Assignee</dt>");
    expect(html).toContain("bob");
    expect(html).toContain("<dt>Plan</dt>");
    expect(html).toContain("<dt>Started</dt>");
    expect(html).not.toContain("<dt>Done</dt>");
    expect(html).toContain("<dt>Written</dt>");
    expect(html).toContain("<dt>Changed</dt>");
    // Across projects the goals are unknown and the row is left out; what is not set is no row.
    const bare = renderToStaticMarkup(
      <TaskTip
        task={task({ assignee: null, goalId: goal().id })}
        place={{ side: "below", shift: 0 }}
      />,
    );
    expect(bare).toContain("sc-task-tip-below");
    expect(bare).not.toContain("<dt>Goal</dt>");
    expect(bare).not.toContain("<dt>Plan</dt>");
    expect(bare).toContain("Nobody");
  });
});

describe("a run and the feed, a page at a time", () => {
  it("says when a run's agent was last heard from, and shows the feed a page at a time", () => {
    const open: RestRun = {
      id: "0199c4d8-0000-7000-8000-000000000041",
      taskId: task().id,
      taskNumber: 7,
      person: alice,
      agent: "Codex",
      status: "running",
      startedAt: "2026-10-11T09:00:00.000Z",
      endedAt: null,
      lastHeardAt: "2026-10-11T10:30:00.000Z",
      summary: null,
      reports: [],
      artifacts: [],
      waitingFor: null,
    };
    const html = renderToStaticMarkup(<RunList runs={[open]} />);
    expect(html).toContain("last heard");
    expect(html).toContain('dateTime="2026-10-11T10:30:00.000Z"');
    expect(html).toContain("Open");
    const over = renderToStaticMarkup(
      <RunList runs={[{ ...open, status: "finished", endedAt: "2026-10-11T11:00:00.000Z" }]} />,
    );
    expect(over).not.toContain("last heard");
    const events = Array.from({ length: 55 }, (_, index) => ({
      id: index + 1,
      kind: "task.created" as const,
      actor: alice,
      agent: null,
      projectId: null,
      taskId: null,
      decisionId: null,
      runId: null,
      documentId: null,
      goalId: null,
      data: { number: index + 1, title: `Task ${index + 1}` },
      createdAt: "2026-10-09T10:00:00.000Z",
    }));
    const feed = renderToStaticMarkup(<EventFeed events={events} />);
    expect(feed).toContain("wrote #55 Task 55");
    expect(feed).toContain("wrote #6 Task 6");
    expect(feed).not.toContain("wrote #5 Task 5");
    expect(feed).toContain("Show 5 more of 5");
  });

  it("lets a project choose its mark, and shows it as it will be", () => {
    const html = renderToStaticMarkup(<ProjectForm onSubmit={() => undefined} />);
    expect(html).toContain("Mark");
    expect(html).toContain("Chosen from the key");
    expect(html).toContain("sc-mark sc-mark-lg");
    expect(html).toContain('type="file"');
    expect(html).toContain('accept="image/png,image/jpeg,image/gif,image/webp"');
    expect(html).not.toContain("A letter or two");
    expect(html).not.toContain("Remove the image");
    // A project with an image shows it in the mark, and offers to take it away.
    const sha256 = "b".repeat(64);
    const marked: RestProject = {
      id: "0199c4d8-0000-7000-8000-000000000001",
      key: "web",
      name: "The web app",
      description: "",
      visibility: "private",
      skillsAddress: null,
      color: null,
      symbol: null,
      icon: { sha256, contentType: "image/png" },
      role: "owner",
      openDecisions: 0,
      openRuns: 0,
      createdAt: "2026-10-09T10:00:00.000Z",
      updatedAt: "2026-10-09T10:00:00.000Z",
    };
    const pictured = renderToStaticMarkup(
      <ProjectForm project={marked} onSubmit={() => undefined} />,
    );
    expect(pictured).toContain("Remove the image");
    expect(pictured).toContain(
      `<img class="sc-mark-image" src="/api/v1/projects/web/icon?v=${sha256.slice(0, 16)}" alt=""/>`,
    );
    expect(pictured).toContain("sc-mark-pictured");
    // The symbol stays under the image, so that the mark is never empty while the image loads.
    expect(pictured).toMatch(/aria-hidden="true">[^<]+<img class="sc-mark-image"/);
    expect(renderToStaticMarkup(<ProjectMark project={{ ...marked, icon: null }} />)).not.toContain(
      "<img",
    );
  });
});

describe("a person's name", () => {
  it("is shown where the host gave one, with the login on hover, and the login where there is none", () => {
    const chip = renderToStaticMarkup(<PersonChip person={alice} />);
    expect(chip).toContain('title="alice"');
    expect(chip).toContain(">Alice Example</span>");
    expect(chip).not.toContain(">alice</span>");
    expect(renderToStaticMarkup(<PersonChip person={{ ...alice, name: null }} />)).toContain(
      ">alice</span>",
    );
    expect(personName({ login: "carol", name: "  " })).toBe("carol");
    expect(renderToStaticMarkup(<Avatar person={{ ...alice, avatar: null }} />)).toContain(">A<");
  });
});

describe("the discussion on a task", () => {
  const task: RestTask = {
    id: "0199c4d8-0000-7000-8000-000000000010",
    number: 7,
    title: "Fix the parser",
    body: "",
    state: "in_progress",
    priority: "normal",
    owner: alice,
    assignee: null,
    parentId: null,
    category: null,
    goalId: null,
    startsOn: null,
    dueOn: null,
    startedAt: null,
    doneAt: null,
    links: [],
    openDecisions: 0,
    openRuns: 0,
    createdAt: "2026-10-09T09:00:00.000Z",
    updatedAt: "2026-10-09T09:00:00.000Z",
  };
  const comment: RestComment = {
    id: "0199c4d8-0000-7000-8000-000000000070",
    taskId: task.id,
    author: bob,
    agent: "Codex on the laptop",
    body: "Which screen? This one: ![the board](board.png)",
    files: [
      {
        id: "0199c4d8-0000-7000-8000-000000000071",
        file: { name: "board.png", size: 2048, contentType: "image/png", sha256: "cd".repeat(32) },
      },
      {
        id: "0199c4d8-0000-7000-8000-000000000072",
        file: {
          name: "shot <2>.webp",
          size: 4096,
          contentType: "image/webp",
          sha256: "ef".repeat(32),
        },
      },
      {
        id: "0199c4d8-0000-7000-8000-000000000073",
        file: { name: "log.txt", size: 10, contentType: "text/plain", sha256: "ab".repeat(32) },
      },
    ],
    createdAt: "2026-10-09T10:30:00.000Z",
  };
  const fileHref = (fileId: string) => `/api/v1/projects/web/files/${fileId}`;

  it("shows a comment with who said it, through which agent, the picture it names in place and the rest after it", () => {
    const html = renderToStaticMarkup(
      <CommentCard comment={comment} fileHref={(file) => fileHref(file.id)} />,
    );
    expect(html).toContain('<span class="sc-person-login">bob</span>');
    expect(html).toContain("as Codex");
    // The picture the text names is in the text, once; the other picture is shown after it; the text file is a link.
    expect(html.split("files/0199c4d8-0000-7000-8000-000000000071").length).toBe(2);
    expect(html).toContain(
      '<img src="/api/v1/projects/web/files/0199c4d8-0000-7000-8000-000000000071" alt="the board"',
    );
    expect(html).toContain('<li class="sc-comment-picture">');
    expect(html).toContain('src="/api/v1/projects/web/files/0199c4d8-0000-7000-8000-000000000072"');
    expect(html).toContain("shot &lt;2&gt;.webp");
    expect(html).toContain(
      '<a href="/api/v1/projects/web/files/0199c4d8-0000-7000-8000-000000000073" rel="nofollow ugc">log.txt</a>',
    );
    // Without an address for the files, the pictures named stay text and the files are named only.
    const unlinked = renderToStaticMarkup(<CommentCard comment={comment} />);
    expect(unlinked).not.toContain("<img");
    expect(unlinked).toContain("<span>log.txt</span>");
  });

  it("reads the comments, the runs and the decisions as one thread in the order they came, with the way to say more", () => {
    const run: RestRun = {
      id: "0199c4d8-0000-7000-8000-000000000020",
      taskId: task.id,
      taskNumber: 7,
      person: alice,
      agent: "Claude Code",
      status: "running",
      startedAt: "2026-10-09T10:00:00.000Z",
      endedAt: null,
      lastHeardAt: "2026-10-09T10:05:00.000Z",
      summary: null,
      reports: [],
      artifacts: [],
      waitingFor: null,
    };
    const decision: RestDecision = {
      id: "0199c4d8-0000-7000-8000-000000000030",
      question: "Keep the old behaviour?",
      body: "",
      options: [
        { id: "1", label: "Keep it" },
        { id: "2", label: "Change it" },
      ],
      taskId: task.id,
      taskNumber: 7,
      raisedBy: alice,
      run: { id: run.id, agent: "Claude Code" },
      answer: null,
      outcome: null,
      createdAt: "2026-10-09T11:00:00.000Z",
      updatedAt: "2026-10-09T11:00:00.000Z",
    };
    expect(threadOf([comment], [run], [decision]).map((item) => item.kind)).toEqual([
      "run",
      "comment",
      "decision",
    ]);
    const html = renderToStaticMarkup(
      <TaskThread
        task={task}
        comments={[comment]}
        runs={[run]}
        decisions={[decision]}
        fileHref={fileHref}
        onAnswer={() => undefined}
        onComment={() => undefined}
      />,
    );
    expect(html.indexOf("sc-run")).toBeLessThan(html.indexOf("sc-comment"));
    expect(html.indexOf("sc-comment")).toBeLessThan(html.indexOf("sc-decision"));
    expect(html).toContain('aria-label="Write a comment"');
    expect(html).toContain('placeholder="A word in the discussion, in Markdown."');
    const silent = renderToStaticMarkup(
      <TaskThread task={task} comments={[]} runs={[]} decisions={[]} empty={<p>none</p>} />,
    );
    expect(silent).toContain("<p>none</p>");
    expect(silent).not.toContain("<form");
  });

  it("has a form that cannot send nothing, in the person's language", () => {
    const html = renderToStaticMarkup(
      <LanguageContext.Provider value={KOREAN}>
        <CommentForm onSubmit={() => undefined} />
      </LanguageContext.Provider>,
    );
    expect(html).toContain('aria-label="댓글 쓰기"');
    expect(html).toContain(">댓글 남기기</button>");
    expect(html).toContain("disabled");
    expect(html).toContain('type="file" multiple');
  });
});

describe("the rules", () => {
  const page = {
    id: "0199c4d8-0000-7000-8000-000000000080",
    path: "rules",
    title: "Rules",
    version: 2,
    updatedBy: bob,
    agent: "Claude Code",
    archivedAt: null,
    createdAt: "2026-10-12T10:00:00.000Z",
    updatedAt: "2026-10-12T11:00:00.000Z",
  };

  it("show the console's own rules as such, a written page with its facts, and a project that adds none", () => {
    const reference = renderToStaticMarkup(
      <RulesView
        rules={{
          source: "reference",
          body: "# Rules for agents <b>here</b>\n\nRead first.",
          page: null,
        }}
        scope="workspace"
        editHref="/settings?rules"
      />,
    );
    expect(reference).toContain("The console&#x27;s own rules hold here");
    expect(reference).toContain("Write the organization&#x27;s rules");
    expect(reference).toContain("Rules for agents &lt;b&gt;here&lt;/b&gt;");
    expect(reference).not.toContain("<b>here</b>");
    const written = renderToStaticMarkup(
      <RulesView
        rules={{ source: "written", body: "Ask first.", page }}
        scope="workspace"
        editHref="/settings?rules"
        onArchive={() => undefined}
      />,
    );
    expect(written).toContain("v2");
    expect(written).toContain("bob");
    expect(written).toContain("as Claude Code");
    expect(written).toContain("Reset to the console&#x27;s rules");
    expect(written).toContain(">Edit<");
    expect(written).toContain("Ask first.");
    expect(written).toContain('class="sc-rules-actions"');
    // Folded under where it comes from, and {language} filled with the language the pages speak.
    const folded = renderToStaticMarkup(
      <RulesView
        rules={{ source: "reference", body: "Write in {language}.", page: null }}
        scope="workspace"
        folded
      />,
    );
    expect(folded).toContain('<details class="sc-rules-fold"><summary>Read the rules</summary>');
    expect(folded).toContain("Write in English.");
    expect(folded).not.toContain("{language}");
    const project = renderToStaticMarkup(
      <RulesView
        rules={{ source: "written", body: "Ask first.", page }}
        scope="project"
        onArchive={() => undefined}
      />,
    );
    expect(project).toContain(">Remove<");
    const none = renderToStaticMarkup(
      <RulesView
        rules={{ source: "none", body: null, page: null }}
        scope="project"
        editHref="/projects/web/settings?rules"
      />,
    );
    expect(none).toContain("This project adds no rules of its own");
    expect(none).toContain("Write this project&#x27;s rules");
    const readOnly = renderToStaticMarkup(
      <RulesView rules={{ source: "none", body: null, page: null }} scope="project" />,
    );
    expect(readOnly).not.toContain("sc-button");
  });

  it("start the form from what holds, and save nothing that would change nothing", () => {
    const fromReference = renderToStaticMarkup(
      <RulesForm
        rules={{ source: "reference", body: "# Theirs", page: null }}
        scope="workspace"
        template=""
        onSubmit={() => undefined}
      />,
    );
    expect(fromReference).toContain("# Theirs");
    expect(fromReference).toContain("disabled");
    const fresh = renderToStaticMarkup(
      <RulesForm
        rules={{ source: "none", body: null, page: null }}
        scope="project"
        template="# Rules of this project"
        onSubmit={() => undefined}
      />,
    );
    expect(fresh).toContain("# Rules of this project");
    expect(fresh).not.toContain("disabled");
    expect(fresh).toContain("Save the rules");
    // The organization's written: the way back to the console's own is offered on the form too.
    const written = renderToStaticMarkup(
      <RulesForm
        rules={{ source: "written", body: "# Ours", page }}
        scope="workspace"
        template=""
        onSubmit={() => undefined}
        onReset={() => undefined}
      />,
    );
    expect(written).toContain("Reset to the console&#x27;s rules");
    expect(fromReference).not.toContain("Reset to the console");
  });
});
