import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentsNeedingYou, agentViewOf } from "../agent-page.js";
import type {
  RestAgent,
  RestCategory,
  RestComment,
  RestConnectRequest,
  RestDecision,
  RestDocument,
  RestEvent,
  RestGoal,
  RestMember,
  RestPerson,
  RestPlugin,
  RestProject,
  RestRun,
  RestSignal,
  RestTask,
  RestToken,
  RestWork,
} from "../api.js";
import { addDays, deviceLanguage, firstDayOfWeek, today, weekOf } from "../dates.js";
import { en, type Messages } from "../i18n/en.js";
import { KOREAN, LanguageContext } from "../i18n/index.js";
import { setupGuideOf } from "../setup-guide.js";
import { AGENT_STATE_REASONS } from "../vocabulary.js";
import {
  AgentChoice,
  AgentControls,
  AgentElsewhereList,
  AgentRunnerFacts,
  AgentSecretList,
  AgentSecretOfferForm,
  AgentSecretOfferList,
  AgentSessionList,
  AgentStateBadge,
  AgentUsage,
  afterTold,
  atWorkOf,
  ChatPane,
  clockOf,
  FOLLOW_SLACK,
  followsAfter,
  followsEnd,
  isOwnReset,
  lacksStarter,
  NO_WHOLE,
  ownResetWaiting,
  pastedName,
  SignalComposer,
  saidLine,
  sameLine,
  subAgentOf,
  subagentOf,
  type TalkHands,
  TalkWaiting,
  TalkWorking,
  TranscriptView,
  takenBy,
  takenOf,
  talkLinesOf,
  talkOf,
  tellsWith,
  turnStarts,
  waitingOf,
  wholeOf,
  withChosen,
  withEarlier,
  withoutChosen,
  withWhole,
  wordOf,
  workingOf,
} from "./agent-page.js";
import {
  AgentAccountForm,
  AgentAccountList,
  AgentPictureSave,
  agentAccountGroups,
  memberSignedInAs,
  suggestLogin,
} from "./agents.js";
import { Board, BoardFilters, byDue, columnStateOf, edgeScrollOf, filterTasks } from "./board.js";
import {
  Calendar,
  daysOf,
  placeTip,
  TaskTip,
  tasksOn,
  Week,
  Workload,
  weekSegments,
  workloadOf,
} from "./calendar.js";
import { CategoryList } from "./categories.js";
import { CommentCard, CommentForm, TaskThread, threadOf } from "./comments.js";
import { ConnectApproval, ConnectCodeForm, ConnectWords } from "./connect.js";
import { DecisionForm } from "./decision-form.js";
import { DecisionAddressForm, DecisionCard, DecisionList, DecisionLog } from "./decision-list.js";
import { DocumentForm, DocumentList, DocumentView, FolderView } from "./documents.js";
import { describeEvent, EventFeed } from "./event-feed.js";
import { GoalForm, GoalList, GoalView, goalMonth } from "./goals.js";
import { HomeGrid, type HomeGridProps, type ProjectGlance } from "./home.js";
import { Markdown } from "./markdown.js";
import { MyDecisions, ReachedDecision } from "./my-decisions.js";
import { PackConnect } from "./pack-connect.js";
import { ListingForm, PeopleList, supervisedBy, TeamForm, TeamList } from "./people.js";
import { opensAbove, Picker } from "./picker.js";
import {
  boundView,
  openingView,
  PictureOverlay,
  PictureThumb,
  panBy,
  wheelFactor,
  wholeScale,
  zoomAround,
} from "./pictures.js";
import { keyOf, MemberList, PackTokenForm, ProjectForm, ProjectMark } from "./projects.js";
import { RemotePicturesContext } from "./remote-pictures.js";
import { GoalTimeline, timelineBars } from "./roadmap.js";
import { RulesForm, RulesView } from "./rules.js";
import { RunList } from "./runs.js";
import { SessionList } from "./sessions.js";
import { AgentInvitationPanel, AgentStartSteps, SetupGuideView } from "./setup.js";
import { Shell } from "./shell.js";
import { SignIn } from "./sign-in.js";
import { SkillList } from "./skills.js";
import { TaskForm } from "./task-form.js";
import { TaskList } from "./task-list.js";
import { TaskView } from "./task-view.js";
import { NewToken, TokenForm, TokenList } from "./tokens.js";
import {
  Avatar,
  Chip,
  DueBadge,
  KindMark,
  PersonChip,
  PersonOption,
  PriorityBadge,
  personName,
  StateBadge,
  Time,
  Workers,
} from "./ui.js";
import { WorkList } from "./work.js";
import {
  deviceTimeZone,
  offsetOf,
  timeZoneGroups,
  WorkspaceServicesForm,
  WorkspaceServicesView,
  WorkspaceSettingsForm,
  WorkspaceSettingsView,
} from "./workspace.js";

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
  workers: [bob],
  parentId: null,
  category: null,
  goalId: null,
  startsOn: null,
  dueOn: null,
  startedAt: null,
  doneAt: null,
  archivedAt: null,
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
  category: null,
  startsOn: null,
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
  decider: alice,
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
          plugin: null,
          data: { number: 7, title: "Ship", from: "ready", to: "in_progress" },
          createdAt: "2026-10-09T10:00:00.000Z",
        },
        KOREAN.messages,
      ),
    ).toBe("#7 Ship을 준비됨에서 진행 중으로 옮겼습니다");
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
    // The second task's column, folded with its count; no menu without a way to edit or to put away.
    expect(html).toContain('class="sc-column sc-column-done sc-column-folded"');
    expect(html).not.toContain("sc-card-menu-button");
    expect(html).not.toContain("<select");
  });

  it("folds the columns of finished work until they are opened, and folds none when told", () => {
    const tasks = [
      task(),
      task({
        id: "0199c4d8-0000-7000-8000-000000000011",
        number: 8,
        title: "Shipped",
        state: "done",
      }),
      task({
        id: "0199c4d8-0000-7000-8000-000000000014",
        number: 9,
        title: "Let go",
        state: "dropped",
      }),
    ];
    const html = renderToStaticMarkup(
      <Board tasks={tasks} taskHref={href} onOpen={() => undefined} />,
    );
    // Done and Dropped are strips: their name, their count and the way to open them, no cards.
    expect(html).toContain('class="sc-column sc-column-done sc-column-folded"');
    expect(html).toContain('class="sc-column sc-column-dropped sc-column-folded"');
    expect(html).toContain('aria-expanded="false" aria-label="Open Done"');
    expect(html).toContain('aria-expanded="false" aria-label="Open Dropped"');
    expect(html).not.toContain("Shipped");
    expect(html).not.toContain("Let go");
    // The work at hand is not foldable, and keeps its cards.
    expect(html).toContain('class="sc-column sc-column-ready"');
    expect(html).toContain("#7");
    const open = renderToStaticMarkup(
      <Board tasks={tasks} taskHref={href} onOpen={() => undefined} folded={[]} />,
    );
    expect(open).not.toContain("sc-column-folded");
    expect(open).not.toContain("sc-column-toggle");
    expect(open).toContain("Shipped");
    expect(open).toContain("Let go");
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
            plugin: null,
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
    // The ways to the forms stand in the task's head, beside its title, not at the foot of its facts.
    const head = plain.slice(
      plain.indexOf('<header class="sc-task-header">'),
      plain.indexOf("</header>"),
    );
    expect(head).toContain('<div class="sc-task-heading">');
    expect(head).toContain('<div class="sc-task-actions">');
    expect(plain.slice(plain.indexOf("<aside"))).not.toContain("sc-task-actions");
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
  it("show the files put on a decision, pictures in place and the rest as links, and take files on the form (ADR-0055)", () => {
    const withFiles = decision({
      body: "The first: ![the first](first.png)",
      files: [
        {
          id: "0199c4d8-0000-7000-8000-000000000041",
          file: { name: "first.png", size: 12, contentType: "image/png", sha256: "a" },
        },
        {
          id: "0199c4d8-0000-7000-8000-000000000042",
          file: { name: "second.png", size: 12, contentType: "image/png", sha256: "b" },
        },
        {
          id: "0199c4d8-0000-7000-8000-000000000043",
          file: { name: "notes.txt", size: 2, contentType: "text/plain", sha256: "c" },
        },
      ],
    });
    const html = renderToStaticMarkup(
      <DecisionCard decision={withFiles} fileHref={(id) => `/projects/web/files/${id}`} />,
    );
    // The picture the context names is shown where the text puts it, once; the second picture
    // and the notes follow the context, the picture small and the notes as a link.
    expect(html.split("files/0199c4d8-0000-7000-8000-000000000041").length).toBe(2);
    expect(html).toContain('<li class="sc-decision-picture">');
    expect(html).toContain('src="/projects/web/files/0199c4d8-0000-7000-8000-000000000042"');
    expect(html).toContain('href="/projects/web/files/0199c4d8-0000-7000-8000-000000000043"');
    expect(html).toContain("notes.txt");
    expect(html).not.toContain('target="_blank"');
    // Without a way to read them, the files are named and not linked; a decision without files shows no files section.
    const unlinked = renderToStaticMarkup(
      <DecisionCard decision={decision({ files: withFiles.files })} />,
    );
    expect(unlinked).not.toContain("sc-picture-thumb");
    expect(unlinked).not.toContain("/files/");
    expect(unlinked).toContain("<span>notes.txt</span>");
    expect(renderToStaticMarkup(<DecisionCard decision={decision()} />)).not.toContain(
      "sc-decision-files",
    );
    // The form takes files, chosen or pasted.
    const form = renderToStaticMarkup(<DecisionForm onSubmit={() => undefined} />);
    expect(form).toContain("Add files");
    expect(form).toContain('type="file"');
  });

  it("say whom a decision is for, take whom to address one to, and list a person's own (ADR-0042)", () => {
    const forBob = decision({ decider: bob });
    const card = renderToStaticMarkup(<DecisionCard decision={forBob} />);
    expect(card).toContain("sc-decision-arrow");
    expect(card).toContain("asked by Alice Example, for bob");
    expect(card).toContain("Waiting for bob.");
    const ownCard = renderToStaticMarkup(<DecisionCard decision={decision()} />);
    expect(ownCard).not.toContain("sc-decision-arrow");
    expect(ownCard).toContain("Waiting for Alice Example.");
    // Several people (ADR-0057): each shown, each waited for.
    const carol: RestPerson = {
      ...bob,
      id: "0199c4d8-0000-7000-8000-000000000003",
      login: "carol",
    };
    const forBoth = renderToStaticMarkup(
      <DecisionCard decision={decision({ decider: bob, deciders: [bob, carol] })} />,
    );
    expect(forBoth).toContain("asked by Alice Example, for bob, carol");
    expect(forBoth).toContain("Waiting for bob, carol.");
    expect(forBoth.match(/sc-person-login/g)?.length).toBeGreaterThanOrEqual(3);
    const form = renderToStaticMarkup(
      <DecisionForm deciders={[alice, bob]} me={alice} onSubmit={() => undefined} />,
    );
    expect(form).toContain("Who decides");
    expect(form).toContain("(you)");
    expect(form).toContain("Add a person");
    expect(renderToStaticMarkup(<DecisionForm onSubmit={() => undefined} />)).not.toContain(
      "Who decides",
    );
    // Addressed anew (ADR-0096): the way stands beside the answer while the decision waits, and
    // beside the word that it waits where it is not answered here; never on a record, never on
    // a plugin's decision, never where the page gives none.
    const addressing = { people: [alice, bob, carol], me: alice, onAddress: () => undefined };
    const waiting = decision({ decider: bob, deciders: [bob] });
    const offered = renderToStaticMarkup(
      <DecisionCard decision={waiting} onAnswer={() => undefined} addressing={addressing} />,
    );
    expect(offered).toContain("Change who decides");
    expect(offered).toContain(">Answer<");
    expect(
      renderToStaticMarkup(<DecisionCard decision={waiting} addressing={addressing} />),
    ).toContain("Change who decides");
    expect(
      renderToStaticMarkup(<DecisionCard decision={waiting} onAnswer={() => undefined} />),
    ).not.toContain("Change who decides");
    expect(
      renderToStaticMarkup(
        <DecisionCard decision={decision({ plugin: "leave" })} addressing={addressing} />,
      ),
    ).not.toContain("Change who decides");
    const record = decision({
      answer: { option: "1", note: null, by: alice, at: "2026-10-20T09:00:00.000Z" },
    });
    expect(
      renderToStaticMarkup(<DecisionCard decision={record} addressing={addressing} />),
    ).not.toContain("Change who decides");
    // The form opens on those it is for, with nothing to save until someone is changed.
    const opened = renderToStaticMarkup(
      <DecisionAddressForm
        decision={decision({ decider: bob, deciders: [bob, carol] })}
        addressing={addressing}
        busy={false}
        onDone={() => undefined}
      />,
    );
    expect(opened).toContain("Who decides");
    expect(opened).toContain("Remove: bob");
    expect(opened).toContain("Remove: carol");
    expect(opened).toContain("Whoever you name finds it among their decisions");
    expect(opened).toContain('<button disabled="" type="submit"');
    const web = { key: "web", name: "The web app", color: null, symbol: null, icon: null };
    const mine = renderToStaticMarkup(
      <MyDecisions
        addressed={{
          items: [
            { project: web, decision: decision() },
            {
              project: web,
              decision: decision({
                id: "0199c4d8-0000-7000-8000-000000000022",
                answer: { option: "2", note: null, by: bob, at: "2026-10-10T10:00:00.000Z" },
              }),
            },
          ],
          more: true,
          onMore: () => undefined,
        }}
        raised={{
          items: [
            {
              project: web,
              decision: decision({ id: "0199c4d8-0000-7000-8000-000000000023", decider: bob }),
            },
          ],
        }}
        decisionHref={(key, id) => `/projects/${key}/decisions/${id}`}
        onAnswer={() => undefined}
      />,
    );
    expect(mine).toContain("Waiting for you");
    expect(mine).toContain("Asked of others");
    expect(mine).toContain("The record");
    expect(mine).toContain("The second");
    // A decision waiting for the person is answered here; one asked of someone else says whom it waits for.
    expect(mine).toContain('role="radiogroup"');
    expect(mine).toContain("Waiting for bob.");
    expect(mine).toContain("Show more");
    expect(mine).toContain("/projects/web/decisions/0199c4d8-0000-7000-8000-000000000022");
    expect(mine).toContain("/projects/web/decisions/0199c4d8-0000-7000-8000-000000000023");
    expect(mine).toContain("in The web app");
    // Every row names who asked and who answers, the one before the arrow, the other after.
    // One arrow per decision asked of someone else; none where the asker answers.
    expect(mine.match(/sc-decision-arrow/g)?.length).toBe(1);
    expect(mine).toContain("asked by Alice Example, for bob");
    const nothing = renderToStaticMarkup(
      <MyDecisions
        addressed={{ items: [] }}
        raised={{ items: [] }}
        decisionHref={(key, id) => `/projects/${key}/decisions/${id}`}
      />,
    );
    expect(nothing).toContain("Nothing waits for your answer.");
    expect(nothing).toContain("You have asked nothing of others.");
    expect(nothing).toContain("Nothing answered yet.");
  });

  it("read the files put on a decision at the decision's own address away from its project: a person's decisions, and a decision reached by its id (ADR-0068)", () => {
    // A decision of a project the person may not see, with a picture its context names and a file after it.
    const vault = { key: "vault", name: "The vault", color: null, symbol: null, icon: null };
    const picture = "0199c4d8-0000-7000-8000-000000000041";
    const notes = "0199c4d8-0000-7000-8000-000000000043";
    const withFiles = decision({
      body: "The first: ![the first](first.png)",
      files: [
        {
          id: picture,
          file: { name: "first.png", size: 12, contentType: "image/png", sha256: "a" },
        },
        { id: notes, file: { name: "notes.txt", size: 2, contentType: "text/plain", sha256: "c" } },
      ],
    });
    const at = (fileId: string) => `/api/v1/decisions/${withFiles.id}/files/${fileId}`;
    // The person's decisions, as the page shows them: read at the decision's address, never the project's.
    const mine = renderToStaticMarkup(
      <MyDecisions
        addressed={{ items: [{ project: vault, decision: withFiles }] }}
        raised={{ items: [] }}
        decisionHref={(_key, id) => `/decisions/${id}`}
        onAnswer={() => undefined}
      />,
    );
    expect(mine).toContain(`src="${at(picture)}"`);
    expect(mine).toContain(`href="${at(notes)}"`);
    expect(mine).not.toContain("/projects/vault/files/");
    // A console that reads them elsewhere is given the project, the file and the decision.
    const asked: string[] = [];
    renderToStaticMarkup(
      <MyDecisions
        addressed={{ items: [{ project: vault, decision: withFiles }] }}
        raised={{ items: [] }}
        decisionHref={(_key, id) => `/decisions/${id}`}
        fileHref={(key, fileId, decisionId) => {
          asked.push(`${key} ${fileId} ${decisionId}`);
          return `/elsewhere/${fileId}`;
        }}
      />,
    );
    expect(asked).toContain(`vault ${notes} ${withFiles.id}`);
    // The decision reached by its id, on its own page: the same address, its project named, and
    // the way to answer only where the person may.
    const reached = renderToStaticMarkup(
      <ReachedDecision
        reached={{ project: vault, decision: withFiles, mayAnswer: true }}
        onAnswer={() => undefined}
      />,
    );
    expect(reached).toContain(`src="${at(picture)}"`);
    expect(reached).toContain(`href="${at(notes)}"`);
    expect(reached).not.toContain("/projects/vault/files/");
    expect(reached).toContain("in The vault");
    expect(reached).toContain('role="radiogroup"');
    const readOnly = renderToStaticMarkup(
      <ReachedDecision
        reached={{ project: vault, decision: withFiles, mayAnswer: false }}
        onAnswer={() => undefined}
      />,
    );
    expect(readOnly).not.toContain('role="radiogroup"');
    expect(readOnly).toContain(`href="${at(notes)}"`);
  });

  it("name the agent an answer and what followed came through, and the one a goal or a task was written through (ADR-0056)", () => {
    const through = decision({
      id: "0199c4d8-0000-7000-8000-000000000022",
      answer: {
        option: "1",
        note: null,
        by: bob,
        at: "2026-10-09T12:00:00.000Z",
        agent: "Claude Code on the laptop",
      },
      outcome: "We did.",
      outcomeBy: alice,
      outcomeAgent: "Codex on the desk",
      outcomeAt: "2026-10-10T09:00:00.000Z",
    });
    const card = renderToStaticMarkup(<DecisionCard decision={through} />);
    expect(card).toContain("answered through Claude Code");
    expect(card).toContain("wrote what followed through Codex");
    // Done by the person themselves, the record names them alone; an older console answers no agent.
    const themselves = renderToStaticMarkup(
      <DecisionCard
        decision={decision({
          answer: { option: "1", note: null, by: bob, at: "2026-10-09T12:00:00.000Z", agent: null },
          outcome: "We did.",
          outcomeBy: alice,
          outcomeAgent: null,
          outcomeAt: "2026-10-10T09:00:00.000Z",
        })}
      />,
    );
    expect(themselves).toContain(" answered ");
    expect(themselves).toContain("wrote what followed");
    expect(themselves).not.toContain("through");
    const older = renderToStaticMarkup(
      <DecisionCard
        decision={decision({
          answer: { option: "1", note: null, by: bob, at: "2026-10-09T12:00:00.000Z" },
          outcome: "We did.",
        })}
      />,
    );
    expect(older).toContain(" answered ");
    expect(older).not.toContain("wrote what followed");
    // The record's rows say it too.
    const rows = renderToStaticMarkup(
      <DecisionList
        decisions={[through]}
        tasks={new Map()}
        taskHref={href}
        decisionHref={(item) => `/projects/web/decisions/${item.id}`}
      />,
    );
    expect(rows).toContain("answered through Claude Code");
    const goalHtml = renderToStaticMarkup(
      <GoalView
        goal={goal({ agent: "Claude Code on the laptop" })}
        tasks={[]}
        taskHref={href}
        today={TODAY}
      />,
    );
    expect(goalHtml).toContain("through Claude Code");
    const taskView = (agent: string | null) =>
      renderToStaticMarkup(
        <TaskView
          task={task({ agent })}
          people={[alice, bob]}
          tasks={[]}
          decisions={[]}
          history={[]}
          taskHref={href}
          onChange={() => undefined}
          onMove={() => undefined}
          onRaiseDecision={() => undefined}
          onAnswer={() => undefined}
        />,
      );
    expect(taskView("Codex on the desk")).toContain("<dt>Written through</dt>");
    expect(taskView("Codex on the desk")).toContain("Codex");
    expect(taskView(null)).not.toContain("Written through");
  });

  it("list the waiting ones as cards with their options and a line of one's own, and the answered ones as the record, a row each", () => {
    const answered = decision({
      id: "0199c4d8-0000-7000-8000-000000000021",
      question: "Name?",
      run: { id: "0199c4d8-0000-7000-8000-000000000040", agent: "Claude Code" },
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
    // The last choice is the person's own words, written on a line of their own.
    expect(html).toContain("Something else");
    expect(html).toContain('placeholder="Your answer, in a line"');
    // The record: what was asked and by whom, what was chosen with the word given and by whom,
    // in a row that leads to the page.
    expect(html).toContain('aria-label="The record"');
    expect(html).toContain(`href="/projects/web/decisions/${answered.id}"`);
    expect(html).toContain("The second");
    expect(html).toContain("Shorter.");
    expect(html).toContain("Alice Example");
    expect(html).toContain("asked through Claude Code");
    expect(html).toContain("bob");
    expect(html).toContain("#7");
    const log = renderToStaticMarkup(<DecisionLog decisions={[answered]} />);
    expect(log).toContain("Name?");
    expect(log).not.toContain("<a ");
  });

  it("mark an answer in the person's own words, and turn the record by pages", () => {
    const own = decision({
      options: [
        { id: "1", label: "The first" },
        { id: "2", label: "The second" },
        { id: "3", label: "Neither: both", own: true },
      ],
      answer: { option: "3", note: null, by: bob, at: "2026-10-09T12:00:00.000Z" },
    });
    const card = renderToStaticMarkup(<DecisionCard decision={own} />);
    expect(card).toContain("Neither: both");
    expect(card).toContain("in their own words");
    expect(renderToStaticMarkup(<DecisionLog decisions={[own]} />)).toContain("in their own words");
    // Twenty-one rows are two pages: the page named is shown, and the steps lead to the others.
    const many = Array.from({ length: 21 }, (_, index) =>
      decision({
        id: `0199c4d8-0000-7000-8000-0000000001${String(index).padStart(2, "0")}`,
        question: `Question ${index}?`,
        answer: own.answer,
      }),
    );
    const pageHref = (page: number) => `/projects/web/decisions?page=${page}`;
    const first = renderToStaticMarkup(<DecisionLog decisions={many} pageHref={pageHref} />);
    expect(first).toContain("Question 0?");
    expect(first).not.toContain("Question 20?");
    expect(first).toContain("1-20 of 21");
    expect(first).toContain('href="/projects/web/decisions?page=2"');
    expect(first).toContain('aria-disabled="true"');
    const second = renderToStaticMarkup(
      <DecisionLog decisions={many} page={2} pageHref={pageHref} />,
    );
    expect(second).toContain("Question 20?");
    expect(second).not.toContain("Question 0?");
    expect(second).toContain("21-21 of 21");
    expect(second).toContain('href="/projects/web/decisions?page=1"');
    // A page past the end is the last; one page needs no steps.
    expect(
      renderToStaticMarkup(<DecisionLog decisions={many} page={9} pageHref={pageHref} />),
    ).toContain("Question 20?");
    expect(
      renderToStaticMarkup(<DecisionLog decisions={[own]} pageHref={pageHref} />),
    ).not.toContain("sc-pager");
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
    plugin: null,
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
    // A decision passed on (ADR-0096) names the question and everyone it is for now.
    expect(
      describeEvent(
        event({
          kind: "decision.addressed",
          data: { question: "Which one?", deciders: ["bob", "carol"] },
        }),
      ),
    ).toBe('passed the decision "Which one?" to bob, carol');
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

  it("says what changed of a member, and how an agent account stands (ADR-0084, ADR-0085)", () => {
    const titled = event({ kind: "person.updated", data: { login: "bob", fields: ["title"] } });
    expect(describeEvent(titled)).toBe("changed the title of bob");
    // A member's title is not a task's: the Korean pack words the two apart.
    expect(describeEvent(titled, KOREAN.messages)).toBe("bob의 직함을 바꿨습니다");
    const mira = { ...alice, login: "mira@acme.example", kind: "agent" as const, handle: "mira" };
    const state = (
      data: RestEvent["data"],
      actor: RestEvent["actor"] = mira,
      words: Messages = en,
    ) =>
      describeEvent(
        event({
          kind: "agent.state_changed",
          actor,
          data: { login: mira.login, handle: "mira", ...data },
        }),
        words,
      );
    // The account says so itself, through its runner.
    expect(state({ state: "running", was: "refused" })).toBe("is running");
    expect(state({ state: "refused", was: "running", detail: "the model would not answer" })).toBe(
      "was refused by its model, and waits: the model would not answer",
    );
    expect(state({ state: "failed" })).toBe("could not start, and waits");
    expect(state({ state: "stopped" })).toBe("stopped");
    // The console says it of an account it has not heard from, and names it.
    expect(state({ state: "unheard", was: "running" }, null)).toBe("has not heard from @mira");

    // Why, in the reader's words and not in the list's: a notification of it is read by a person.
    expect(state({ state: "failed", detail: "usage_limit" })).toBe(
      "could not start, and waits: its product's usage limit is reached",
    );
    expect(state({ state: "failed", detail: "usage_limit" }, mira, KOREAN.messages)).toBe(
      "시작하지 못해 기다리고 있습니다: 제품의 사용량 한도에 닿았습니다",
    );
    expect(state({ state: "running", detail: "reset" }, mira, KOREAN.messages)).toBe(
      "실행 중입니다: 새 대화를 시작했습니다",
    );
    for (const detail of AGENT_STATE_REASONS) {
      expect(state({ state: "running", detail }, mira, KOREAN.messages)).not.toContain(detail);
    }
    // What the sentence says already is not said twice.
    expect(state({ state: "refused", detail: "model_refused" })).toBe(
      "was refused by its model, and waits",
    );
    expect(state({ state: "unheard", detail: "no_heartbeat" }, null)).toBe(
      "has not heard from @mira",
    );
    // A reason of a later console, or a name every object has, is said as it came.
    expect(state({ state: "failed", detail: "toString" })).toBe(
      "could not start, and waits: toString",
    );
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
        event({ kind: "task.updated", data: { number: 7, fields: ["title", "workers"] } }),
      ),
    ).toBe("changed the title, the workers of #7");
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

  it("heads the events by the day they fell on, each row with its hour", () => {
    const html = renderToStaticMarkup(
      <EventFeed
        events={[
          event({
            id: 1,
            createdAt: "2026-10-09T10:00:00.000Z",
            data: { number: 1, title: "First" },
          }),
          event({
            id: 2,
            createdAt: "2026-10-09T11:30:00.000Z",
            data: { number: 2, title: "Second" },
          }),
          event({
            id: 3,
            createdAt: "2026-10-12T09:00:00.000Z",
            data: { number: 3, title: "Third" },
          }),
        ]}
      />,
    );
    expect(html.match(/<section class="sc-feed-day">/g)).toHaveLength(2);
    expect(html.match(/<li class="sc-feed-item/g)).toHaveLength(3);
    expect(html).toContain('<h3 class="sc-feed-day-title"><time dateTime="2026-10-12">');
    // The newest day first, and within it the newest event first; a row says its hour, not its day.
    expect(html.indexOf('dateTime="2026-10-12"')).toBeLessThan(
      html.indexOf('dateTime="2026-10-09"'),
    );
    expect(html.indexOf("wrote #2 Second")).toBeLessThan(html.indexOf("wrote #1 First"));
    expect(html).toContain('class="sc-time sc-feed-clock" dateTime="2026-10-09T11:30:00.000Z"');
    expect(html).not.toContain("sc-feed-item sc-time");
    // Two events by the same hands in a day make one run, headed by the name once.
    expect(html.match(/<li class="sc-feed-run">/g)).toHaveLength(2);
    expect(html.match(/sc-feed-actor/g)).toHaveLength(2);
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
    // A picture from elsewhere is read through the console (ADR-0048), never from elsewhere.
    expect(html).not.toContain('src="https://img.example/x.png"');
    expect(html).toContain('src="/api/v1/pictures?src=https%3A%2F%2Fimg.example%2Fx.png"');
    expect(html.toLowerCase()).toContain('referrerpolicy="no-referrer"');
    const provided = renderToStaticMarkup(
      <RemotePicturesContext.Provider value={(url) => `/pictures/${encodeURIComponent(url)}`}>
        <Markdown source="![ok](https://img.example/x.png)" />
      </RemotePicturesContext.Provider>,
    );
    expect(provided).toContain('src="/pictures/https%3A%2F%2Fimg.example%2Fx.png"');
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

  it("show a picture attached to the page where the body names it, as the text has it", () => {
    const html = renderToStaticMarkup(
      <DocumentView
        document={document({
          body: "# Welcome\n\n![the board](board.png) and ![elsewhere](other.png) and ![far](https://img.example/x.png)",
          files: [
            {
              id: "0199c4d8-0000-7000-8000-000000000071",
              label: null,
              file: { name: "board.png", size: 4096, contentType: "image/png", sha256: "cd" },
              addedBy: alice,
              agent: null,
              createdAt: "2026-10-10T11:00:00.000Z",
            },
          ],
        })}
        docHref={docHref}
        folderHref={folderHref}
        fileHref={(file) => `/api/v1/projects/web/docs/guides%2Fonboarding/files/${file.id}`}
      />,
    );
    expect(html).toContain(
      '<img src="/api/v1/projects/web/docs/guides%2Fonboarding/files/0199c4d8-0000-7000-8000-000000000071" alt="the board"',
    );
    expect(html).toContain('<span class="sc-prose-image-text">elsewhere</span>');
    expect(html).toContain('src="/api/v1/pictures?src=https%3A%2F%2Fimg.example%2Fx.png"');
    // In place and as the text has it: no thumbnail that opens large.
    expect(html).not.toContain("sc-picture-thumb");
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
    // A picture pasted or chosen goes with the page.
    expect(fresh).toContain("Add pictures");
    expect(fresh).toContain('accept="image/*"');
    const again = renderToStaticMarkup(
      <DocumentForm document={document()} onSubmit={() => undefined} />,
    );
    expect(again).toMatch(/<input[^>]*disabled[^>]*value="guides\/onboarding"/);
    expect(again).toContain("Write a new version");
  });
});

describe("the shell and signing in", () => {
  it("opens a group of plugins from a tab over the page, and lists them one by one in the menu", () => {
    const group = {
      href: "/plugins/hello/greetings",
      label: "Operations",
      current: true,
      children: [
        { href: "/plugins/hello/greetings", label: "Hello", current: true },
        { href: "/plugins/call/room", label: "Call", current: false },
      ],
    };
    const html = renderToStaticMarkup(
      <Shell title="Acme" nav={[group]} menu={[group]} person={alice} onNavigate={() => undefined}>
        <p>content</p>
      </Shell>,
    );
    // The tab is a button that opens a popover: in the top layer, where the row of tabs, which
    // scrolls sideways and clips what hangs out of it, clips nothing of the list.
    expect(html).toContain('class="sc-tab sc-tab-summary sc-tab-current"');
    expect(html).toMatch(/<button[^>]* popovertarget="[^"]+"/i);
    expect(html).toMatch(/<div[^>]* popover="auto"[^>]* class="sc-menu-panel sc-tab-group-panel"/);
    // In the list and in the person's menu alike, each plugin of the group is a link of its own.
    expect(html.match(/href="\/plugins\/call\/room"/g)).toHaveLength(2);
    expect(html).toContain('<p class="sc-menu-heading">Operations</p>');
    // The list names each alone, the page's own marked; so does the menu.
    expect(html).toContain('class="sc-menu-link sc-group-link" aria-current="page">Hello</a>');
    expect(html).toContain('class="sc-menu-link sc-group-link">Call</a>');
    expect(html).not.toContain("sc-group-link-note");
  });

  it("stops a long name of a tab short, its title saying it whole", () => {
    const long = "Customer relationships and the sales pipeline";
    const html = renderToStaticMarkup(
      <Shell
        title="Acme"
        nav={[
          { href: "/work", label: "My work", current: true },
          { href: "/plugins/crm/home", label: long, current: false },
        ]}
        person={alice}
        onNavigate={() => undefined}
      >
        <p>content</p>
      </Shell>,
    );
    expect(html).toContain(`title="${long}"`);
    expect(html).toContain(`<span class="sc-tab-label">${long}</span>`);
    // A short name has no title to say it again.
    expect(html).not.toContain('title="My work"');
    // Hangul runs about twice as wide: a name of fifteen syllables may stop short, and has one.
    const korean = "인사와 급여와 근태를 한곳에서 관리";
    const wide = renderToStaticMarkup(
      <Shell
        title="Acme"
        nav={[
          { href: "/plugins/hr/home", label: korean, current: false },
          { href: "/plugins/leave/home", label: "휴가", current: false },
        ]}
        person={alice}
        onNavigate={() => undefined}
      >
        <p>content</p>
      </Shell>,
    );
    expect(wide).toContain(`title="${korean}"`);
    expect(wide).not.toContain('title="휴가"');
  });

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
          { key: "gh", label: "GitHub", admits: { organization: "acme", domains: [] } },
          {
            key: "google",
            label: "Google",
            admits: { organization: null, domains: ["example.com"] },
          },
        ]}
        returnTo="/decisions"
        failure="refused"
      />,
    );
    expect(html).toContain('href="/auth/gh/login?return_to=%2Fdecisions"');
    expect(html).toContain('href="/auth/google/login?return_to=%2Fdecisions"');
    expect(html).toContain("Sign in with GitHub");
    expect(html).toContain("Sign in with Google");
    // Each button carries the provider's mark, and says under it who gets in through it.
    expect(html.match(/class="sc-sign-in-mark/g)).toHaveLength(2);
    expect(html).toContain("For the members of acme, the organization at GitHub.");
    expect(html).toContain("For accounts at example.com.");
    expect(html).not.toContain("aria-busy");
    expect(html).toContain("not a member");
    // An older console says nothing of who gets in; a way with neither names the listings.
    const plain = renderToStaticMarkup(
      <SignIn
        title="Acme"
        providers={[
          { key: "gh", label: "GitHub" },
          { key: "google", label: "Google", admits: { organization: null, domains: [] } },
        ]}
        returnTo="/"
      />,
    );
    expect(plain.match(/sc-sign-in-admits/g)).toHaveLength(1);
    expect(plain).toContain("For the people an administrator added.");
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
            client: "0.0.9",
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
    // Of an older line, the console no longer takes it; within the line it would be behind (ADR-0038).
    expect(html).toContain("console 0.0.9");
    expect(html).toContain("must be updated");
    expect(html.split("must be updated")).toHaveLength(2);
    expect(html.match(/>Disconnect</g)).toHaveLength(3);
    const readOnly = renderToStaticMarkup(<TokenList tokens={[token]} />);
    expect(readOnly).not.toContain("Disconnect");
    expect(renderToStaticMarkup(<TokenList tokens={[]} empty={<p>none</p>} />)).toBe("<p>none</p>");
  });

  it("lists the browsers a person is signed in on, this one marked, with the way to end the others (board #309)", () => {
    const session = {
      id: "0199c4d8-0000-7000-8000-000000000041",
      current: true,
      createdAt: "2026-10-01T09:00:00.000Z",
      lastSeenAt: "2026-10-09T12:00:00.000Z",
      expiresAt: "2026-11-08T12:00:00.000Z",
      browser: "Chrome",
      platform: "Windows",
      address: "203.0.113.5",
    };
    const other = {
      ...session,
      id: "0199c4d8-0000-7000-8000-000000000042",
      current: false,
      browser: "Safari",
      platform: null,
      address: null,
    };
    const html = renderToStaticMarkup(
      <SessionList
        sessions={[session, other]}
        idleDays={30}
        onEnd={() => undefined}
        onEndOthers={() => undefined}
      />,
    );
    expect(html).toContain("Chrome on Windows");
    expect(html).toContain("Current session");
    expect(html.match(/class="sc-divider sc-session sc-session-current"/g)).toHaveLength(1);
    expect(html).toContain("IP 203.0.113.5");
    expect(html).toContain("Safari");
    expect(html).toContain("30 days");
    // The current one is not ended from here; the other is, and all the others at once.
    expect(html.match(/>Sign out</g)).toHaveLength(1);
    expect(html).toContain("Sign out of all other sessions");
    const alone = renderToStaticMarkup(
      <SessionList sessions={[session]} onEnd={() => undefined} onEndOthers={() => undefined} />,
    );
    expect(alone.match(/>Sign out</g)).toBeNull();
    expect(alone).not.toContain("Sign out of all other sessions");
    // A phone is drawn as one, and a browser the server could not name is said to be unknown.
    const phone = renderToStaticMarkup(
      <SessionList
        sessions={[
          { ...other, browser: "Safari", platform: "iOS" },
          { ...other, id: "0199c4d8-0000-7000-8000-000000000043", browser: null },
        ]}
      />,
    );
    expect(phone).toContain('<rect x="5.5" y="3" width="9" height="14" rx="2">');
    expect(phone).toContain("Unknown browser");
    // A command signed in as the account itself (ADR-0084) is one of its sessions, by what it
    // called itself, and ended as any other.
    const command = renderToStaticMarkup(
      <SessionList
        sessions={[
          session,
          {
            ...other,
            browser: null,
            platform: null,
            kind: "command" as const,
            name: "console on <a> mac-mini",
          },
        ]}
        onEnd={() => undefined}
      />,
    );
    expect(command).toContain("The console command: console on &lt;a&gt; mac-mini");
    expect(command).not.toContain("Unknown browser");
    expect(command.match(/>Sign out</g)).toHaveLength(1);
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

describe("the agent accounts (ADR-0084)", () => {
  const parts = {
    set: 1,
    palette: 0,
    ground: 0,
    form: 1,
    material: 0,
    accent: 0,
    vein: 7,
  };
  const mira: RestPerson = {
    ...bob,
    id: "0199c4d8-0000-7000-8000-000000000009",
    login: "mira@acme.example",
    name: "Mira",
    kind: "agent",
    handle: "mira",
    title: "Release engineer",
    managerId: alice.id,
    avatarParts: parts,
    invited: true,
  };

  it("lists each with who it is, how it stands, what it is doing now and whom it reports to", () => {
    const seen = renderToStaticMarkup(
      <AgentAccountList agents={[{ person: mira, manager: alice, supervised: false }]} />,
    );
    expect(seen).toContain("Mira");
    expect(seen).toContain('<span class="sc-person-card-title">Release engineer</span>');
    expect(seen).toContain('<span class="sc-person-card-note">@mira</span>');
    // What is kept of the account, the login it signs in with among it, is said on its page.
    expect(seen).not.toContain("mira@acme.example");
    expect(seen).toContain(">Invited<");
    expect(seen).toContain("<dt>Now</dt>");
    expect(seen).toContain("Nobody has signed in with it yet.");
    expect(seen).toMatch(/<dt>Manager<\/dt><dd><span class="sc-person"[^>]*>.*?Alice Example/);
    // Whoever looks is not told that they are the manager of what reports to them.
    expect(
      renderToStaticMarkup(
        <AgentAccountList
          agents={[{ person: mira, manager: alice, supervised: true }]}
          me={alice}
        />,
      ),
    ).not.toContain("<dt>Manager</dt>");
    // How it stands, why and since when, and what it runs, where its runner has said.
    const running = renderToStaticMarkup(
      <AgentAccountList
        agents={[
          {
            person: { ...mira, invited: undefined },
            manager: alice,
            supervised: true,
            state: {
              state: "stopped",
              reason: "stop",
              since: "2026-11-10T09:00:00.000Z",
              heardAt: "2026-11-10T09:00:30.000Z",
            },
            runner: {
              delivered: 3,
              latest: 3,
              session: null,
              machine: { name: "studio-2", os: "Darwin 25.1.0", user: "mira" },
              runner: "0.5.0",
              product: { driver: "claude", name: "Claude Code", version: "2.1.321", tried: true },
              offers: null,
              running: { model: "opus", effort: null },
              settings: { model: null, effort: null },
            },
          },
        ]}
        href={() => "/agents/mira"}
      />,
    );
    expect(running).toContain(">Stopped<");
    // The moment under the reason is said with the state's word: it is since when the account
    // stands so, and never reads as when the reason was said. An answer that names no moment
    // for the reason, a console's of before, shows the reason with none.
    expect(running).toContain(
      '<span>a supervisor stopped it</span><span class="sc-muted">stopped since <time',
    );
    // A reason said later, under a state that stayed, has its own moment beside it; the state
    // keeps its own under it. In Korean the state's word follows its moment.
    const later = {
      person: { ...mira, invited: undefined },
      manager: alice,
      supervised: true,
      state: {
        state: "running" as const,
        reason: "reset",
        since: "2026-11-08T08:41:00.000Z",
        reasonAt: "2026-11-10T14:12:00.000Z",
        heardAt: "2026-11-10T14:12:30.000Z",
      },
    };
    const reset = renderToStaticMarkup(<AgentAccountList agents={[later]} />);
    expect(reset).toMatch(
      /<span>it began a new conversation<span class="sc-muted"> \(<time class="sc-time" dateTime="2026-11-10T14:12:00\.000Z"[^>]*>[^<]+<\/time>\)<\/span><\/span><span class="sc-muted">running since <time class="sc-time" dateTime="2026-11-08T08:41:00\.000Z"/,
    );
    expect(
      renderToStaticMarkup(
        <LanguageContext.Provider value={KOREAN}>
          <AgentAccountList agents={[later]} />
        </LanguageContext.Provider>,
      ),
    ).toMatch(
      /새 대화를 시작했습니다<span class="sc-muted"> \(<time[^>]*dateTime="2026-11-10T14:12:00\.000Z"[^>]*>[^<]+<\/time>\)<\/span><\/span><span class="sc-muted"><time[^>]*dateTime="2026-11-08T08:41:00\.000Z"[^>]*>[^<]+<\/time>부터 실행 중/,
    );
    // A reason that came with its state, within the minute, is of the state's moment: one
    // moment is shown, the state's.
    const together = renderToStaticMarkup(
      <AgentAccountList
        agents={[
          {
            ...later,
            state: {
              state: "failed",
              reason: "usage_limit",
              since: "2026-11-10T14:12:00.000Z",
              reasonAt: "2026-11-10T14:12:02.000Z",
              heardAt: null,
              until: "2026-11-10T19:00:00.000Z",
            },
          },
        ]}
      />,
    );
    expect(together).toContain(
      '<span>its product&#x27;s usage limit is reached</span><span class="sc-muted">failed since <time',
    );
    expect(together.match(/<time /g)).toHaveLength(2);
    expect(running).toContain("<dt>Runs</dt><dd>Claude Code 2.1.321 · opus</dd>");
    expect(running).toContain('<a class="sc-agent-card-link" href="/agents/mira">Mira</a>');
    expect(seen).toContain(
      '<img class="sc-avatar-drawn sc-avatar sc-avatar-lg" src="data:image/png;base64,',
    );
    // The list offers nothing to do: an account's picture is saved on its own page (ADR-0084).
    expect(seen).not.toContain("<button");
    const supervised = renderToStaticMarkup(
      <AgentAccountList
        agents={[
          { person: { ...mira, invited: undefined }, manager: null, supervised: true },
          {
            person: { ...mira, id: bob.id, handle: "dex", status: "deactivated" },
            manager: alice,
            supervised: true,
          },
        ]}
      />,
    );
    expect(supervised).toContain("Not shown to you");
    expect(supervised).toContain(">Deactivated<");
    // Signed in and with no runner yet, an account says so; one that is out says only that.
    expect(supervised).toContain(">Not set up<");
    expect(supervised).toContain("No runner has been heard from yet");
    expect(supervised).not.toContain(">Invited<");
    expect(renderToStaticMarkup(<AgentAccountList agents={[]} empty={<p>none</p>} />)).toBe(
      "<p>none</p>",
    );
  });

  it("groups the accounts as the agents' page lists them: the ones managed, and the others for an administrator", () => {
    const ines: RestPerson = {
      ...mira,
      id: "0199c4d8-0000-7000-8000-00000000000a",
      handle: "ines",
    };
    const people = [alice, bob, mira, { ...ines, managerId: bob.id }];
    const accounts = [
      { person: mira, manager: alice, supervised: true },
      { person: { ...ines, managerId: bob.id }, manager: bob, supervised: true },
    ];
    // An administrator supervises every account: which they manage is the reporting line's to say.
    const administrator = agentAccountGroups(accounts, { ...alice, role: "admin" }, people);
    expect(administrator.managed.map((one) => one.person.handle)).toEqual(["mira"]);
    expect(administrator.others.map((one) => one.person.handle)).toEqual(["ines"]);
    // An account whose manager reports to them is theirs too.
    const above = agentAccountGroups(
      accounts,
      { ...alice, role: "admin" },
      people.map((one) => (one.id === bob.id ? { ...one, managerId: alice.id } : one)),
    );
    expect(above.managed.map((one) => one.person.handle)).toEqual(["mira", "ines"]);
    expect(above.others).toEqual([]);
    // Anyone else is listed what the console said is theirs, and nothing of the rest.
    const member = agentAccountGroups(
      [
        { person: mira, manager: alice, supervised: false },
        { person: ines, manager: bob, supervised: true },
      ],
      { ...bob, role: "member" },
      people,
    );
    expect(member.managed.map((one) => one.person.handle)).toEqual(["ines"]);
    expect(member.others).toEqual([]);
    expect(agentAccountGroups(accounts, undefined, people).others).toEqual([]);
  });

  it("offers an account's picture as a file, with its face and what the file is for", () => {
    const seen = renderToStaticMarkup(<AgentPictureSave person={mira} />);
    expect(seen).toContain(
      '<img class="sc-avatar-drawn sc-avatar sc-avatar-lg" src="data:image/png;base64,',
    );
    expect(seen).toContain(">Download its profile picture (PNG)<");
    expect(seen).toContain("A PNG of 1024 pixels a side");
    expect(renderToStaticMarkup(<AgentPictureSave person={{ ...mira, avatarParts: null }} />)).toBe(
      "",
    );
  });

  it("shows an account's work to whoever sees it, and the rest of its page to its supervisors alone", () => {
    // The picture and the names of the secrets are on the settings, which a supervisor reads.
    for (const tab of ["live", "sessions", "settings"] as const) {
      expect(agentViewOf(tab, true)).toBe(tab);
    }
    expect(agentViewOf("sessions", false)).toBe("closed");
    expect(agentViewOf("settings", false)).toBe("closed");
    expect(agentViewOf("work", false)).toBe("work");
    expect(agentViewOf("work", true)).toBe("work");
    // The page itself, opened by whoever only sees the account, is its work: what they may read.
    expect(agentViewOf("live", false)).toBe("work");
  });

  it("proposes the login an account signs in with from its handle and what the provider admits", () => {
    const google = {
      key: "google" as const,
      label: "Google",
      admits: { organization: null, domains: ["acme.example", "acme.test"] },
    };
    const gh = {
      key: "gh" as const,
      label: "GitHub",
      admits: { organization: "Acme", domains: [] },
    };
    expect(suggestLogin("mira", google)).toBe("mira@acme.example");
    expect(suggestLogin("mira", gh)).toBe("acme-mira");
    // Nothing where the deployment names neither: the administrator writes the login.
    expect(suggestLogin("mira", { key: "gh", label: "GitHub" })).toBe("");
    expect(suggestLogin("mira", { ...google, admits: { organization: null, domains: [] } })).toBe(
      "",
    );
    expect(suggestLogin("", google)).toBe("");
    expect(suggestLogin("mira", undefined)).toBe("");
  });

  it("finds the member a login would make the agent account, whom the form asks about first (ADR-0104)", () => {
    const flora: RestPerson = {
      ...bob,
      id: `${bob.id.slice(0, -1)}9`,
      login: "Flora@acme.example",
    };
    const agent: RestPerson = {
      ...bob,
      id: `${bob.id.slice(0, -1)}8`,
      login: "acme-mira",
      kind: "agent",
    };
    const people = [alice, bob, flora, agent];
    // As the hosts compare logins, without regard to case, and at the provider the login is of.
    expect(memberSignedInAs(people, "gh", " BOB ")).toBe(bob);
    expect(memberSignedInAs(people, "google", "flora@acme.example")).toBe(flora);
    expect(memberSignedInAs(people, "google", "bob")).toBeUndefined();
    // Nobody for a login nobody has, for one that is an agent account's already, and for an
    // administrator's: the console refuses those two in words of its own.
    expect(memberSignedInAs(people, "gh", "acme-vesta")).toBeUndefined();
    expect(memberSignedInAs(people, "gh", "acme-mira")).toBeUndefined();
    expect(memberSignedInAs(people, "gh", "alice")).toBeUndefined();
    expect(memberSignedInAs(people, undefined, "bob")).toBeUndefined();
    expect(memberSignedInAs(people, "gh", "")).toBeUndefined();
  });

  it("is added from a form in three parts: who it is, the account it signs in with, whom it reports to", () => {
    const form = renderToStaticMarkup(
      <AgentAccountForm
        proposals={[
          { seed: "s-1", name: "Mira", handle: "mira", avatarParts: parts },
          { seed: "s-2", name: "Juno", handle: "juno", avatarParts: { ...parts, palette: 1 } },
        ]}
        onRoll={() => undefined}
        providers={[
          { key: "google", label: "Google", admits: { organization: null, domains: [] } },
          { key: "gh", label: "GitHub" },
        ]}
        people={[alice, bob]}
        me={alice}
        projects={[]}
        onSubmit={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(form).toContain("Choose a persona");
    expect(form.match(/class="sc-agent-proposal"/g)).toHaveLength(2);
    expect(form).toContain(">@mira<");
    // The way to roll them again stands beside the part's title, over the proposals.
    expect(form).toMatch(
      /<div class="sc-section-head"><h2 class="sc-section-title">[^<]+<\/h2><button[^>]*>Roll again<\/button><\/div>/,
    );
    expect(form).not.toMatch(/sc-agent-proposal-row">[\s\S]*?Roll again[\s\S]*?<\/fieldset>/);
    // Whoever makes it is its manager, unless another is chosen.
    expect(form).toMatch(/sc-picker-chosen[\s\S]*?Alice Example/);
    // Three parts, each under its heading.
    expect(form.match(/<section class="sc-form-part" aria-label="([^"]+)"/g)).toEqual([
      '<section class="sc-form-part" aria-label="Who it is"',
      '<section class="sc-form-part" aria-label="The account it signs in with"',
      '<section class="sc-form-part" aria-label="Whom it reports to, and where it starts"',
    ]);
    // The account it signs in with is the one thing to get right: the form says what kind of
    // name it is, and that the account has to be there before the machine is set up. Who makes
    // it at the provider, and what a provider's terms ask, it does not say (ADR-0094).
    expect(form).toContain(">Signs in through<");
    expect(form).toContain(">Google Workspace address<");
    expect(form).toContain('placeholder="mira@acme.example"');
    expect(form).toContain(
      "Write the account it signs in with at Google. It need not be there yet: it has to be before its machine is set up.",
    );
    expect(form).not.toMatch(/a person makes|a person registers|terms/i);
    // No member signs in with a login that is not written yet: nothing is asked of one.
    expect(form).not.toContain("Make this member the agent account");
    expect(form).toContain(">Add the agent account<");
    expect(form).toContain("Next, on its page: an invitation that leads a machine to it.");
    // Nothing is sent until there is a name, a login and a project.
    expect(form).toMatch(
      /<button[^>]*type="submit"[^>]*disabled=""|<button[^>]*disabled=""[^>]*type="submit"/,
    );
  });

  it("says what stands between an account just added and one at work, each step done as the console sees it", () => {
    const steps = (props: Partial<Parameters<typeof AgentStartSteps>[0]>) =>
      renderToStaticMarkup(
        <AgentStartSteps
          login="mira@acme.example"
          provider="Google"
          signedIn={false}
          invited={false}
          onMachine={false}
          heard={false}
          invitation={<button type="button">invite</button>}
          {...props}
        />,
      );
    const fresh = steps({});
    // The four, in order, the first one next; the account is named, and when it has to be there.
    expect(fresh.match(/<span class="sc-step-title">([^<]+)/g)).toEqual([
      '<span class="sc-step-title">The account it signs in with',
      '<span class="sc-step-title">An invitation',
      '<span class="sc-step-title">On its machine',
      '<span class="sc-step-title">Its runner',
    ]);
    expect(fresh).toContain('<li class="sc-step sc-step-next" aria-current="step">');
    expect(fresh).toContain(
      "mira@acme.example, at Google. It is made there where it is not yet, and what it signs in with is asked for once, on its machine.",
    );
    expect(fresh).toContain(">invite</button>");
    expect(fresh).not.toContain(">Done<");
    expect(fresh).not.toMatch(/a person makes|terms/i);
    // A login at a git host goes to whoever registers it: the step says what the account's first
    // sign-in is held to (ADR-0126), and marks the account not confirmed where the host did not
    // say which account the login is. A console older than the answer says nothing: the login.
    const atGitHost = steps({ login: "acme-mira", provider: "GitHub" });
    expect(atGitHost).toContain(
      "acme-mira, at GitHub. Not confirmed: the host was not asked which account that is. It has to be there already, an account the organization holds: until it has signed in here, whoever holds that login is let in as this account.",
    );
    expect(atGitHost).toContain('<span class="sc-badge sc-badge-warning">Not confirmed</span>');
    expect(atGitHost).not.toContain("It is made there where it is not yet");
    expect(steps({ login: "acme-mira", provider: "GitHub", firstSignIn: "login" })).toBe(atGitHost);
    const confirmed = steps({ login: "acme-mira", provider: "GitHub", firstSignIn: "account" });
    expect(confirmed).toContain(
      "acme-mira, at GitHub. Confirmed there: that account alone is let in as this one, whatever it is called by then.",
    );
    expect(confirmed).not.toContain("Not confirmed");
    expect(confirmed).not.toContain("whoever holds that login");
    const byMember = steps({ login: "acme-mira", provider: "GitHub", firstSignIn: "member" });
    expect(byMember).toContain(
      "acme-mira, at GitHub. Not confirmed: the organization there has no member called so, or could not be asked. It is let in once it is a member there, and nobody else is under that login.",
    );
    expect(byMember).toContain(">Not confirmed</span>");
    // A Workspace makes its own addresses: nothing is held, whatever is answered, and once the
    // account has signed in nothing is marked.
    expect(fresh).not.toContain("Not confirmed");
    expect(
      steps({ login: "acme-mira", provider: "GitHub", firstSignIn: "login", signedIn: true }),
    ).not.toContain("Not confirmed");
    // An invitation stands: the machine is next.
    const invited = steps({ invited: true });
    expect(invited.match(/>Done</g)).toHaveLength(1);
    expect(invited.indexOf("sc-step-next")).toBeGreaterThan(invited.indexOf("An invitation"));
    // Its command signed in on a machine: the account signed in, and the invitation did its work.
    const onMachine = steps({ onMachine: true });
    expect(onMachine.match(/>Done</g)).toHaveLength(3);
    expect(onMachine).toContain("It has signed in as mira@acme.example.");
    expect(onMachine).toContain("Its command is signed in as the account.");
    expect(onMachine).not.toContain(">invite</button>");
    // Heard from: every step is done, whatever else was seen.
    const heard = steps({ heard: true });
    expect(heard.match(/>Done</g)).toHaveLength(4);
    expect(heard).not.toContain("sc-step-next");
    expect(heard).toContain("Its runner is heard from.");
  });

  it("signs an account in through the service the workspace names for it, whichever provider comes first (ADR-0089)", () => {
    const providers = [
      { key: "gh" as const, label: "GitHub" },
      { key: "google" as const, label: "Google", admits: { organization: null, domains: [] } },
    ];
    const render = (services: object) =>
      renderToStaticMarkup(
        <AgentAccountForm
          proposals={[]}
          providers={providers}
          workspace={{
            name: "Acme",
            tokenDaysAtMost: null,
            skills: { source: "https://skillcdn.test", address: null },
            handle: "acme",
            domain: "acme.example",
            services,
          }}
          people={[alice]}
          me={alice}
          projects={[]}
          onSubmit={() => undefined}
        />,
      );
    expect(render({ identity: { kind: "google-workspace" } })).toContain(
      ">Google Workspace address<",
    );
    const github = render({ identity: { kind: "github" } });
    expect(github).toContain(">GitHub login<");
    // At a git host the account is there before it is added here, and the form says why.
    expect(github).toContain("A login nobody holds yet is whoever registers it first.");
    expect(github).not.toContain("need not be there yet");
    // With no identity service named, the first way people sign in here.
    expect(render({})).toContain(">GitHub login<");
  });

  it("says that the personas are on their way, and that they could not be read, where there is none to choose", () => {
    const form = (props: { readonly failed?: boolean; readonly lang?: "ko" }) => {
      const drawn = (
        <AgentAccountForm
          proposals={[]}
          proposalsFailed={props.failed}
          onRoll={() => undefined}
          providers={[{ key: "gh", label: "GitHub" }]}
          people={[alice]}
          me={alice}
          projects={[]}
          onSubmit={() => undefined}
        />
      );
      return renderToStaticMarkup(
        props.lang === "ko" ? (
          <LanguageContext.Provider value={KOREAN}>{drawn}</LanguageContext.Provider>
        ) : (
          drawn
        ),
      );
    };
    // While they are asked for, the form says so, where it stood empty without a word.
    const asking = form({});
    expect(asking).toContain('<p class="sc-field-hint" role="status">Rolling a few personas</p>');
    expect(asking).not.toContain("could not be read");
    // Where they could not be read it says that, and what to do: the name and the handle are
    // written by hand, the console draws the picture, and the way to roll again is still there.
    const failed = form({ failed: true });
    expect(failed).toContain(
      '<p class="sc-form-error" role="alert">The personas could not be read. Write the name and the handle yourself, or roll again; the console draws the picture.</p>',
    );
    expect(failed).not.toContain("Rolling a few personas");
    expect(failed).toContain(">Roll again<");
    expect(form({ failed: true, lang: "ko" })).toContain(
      "페르소나 후보를 불러오지 못했습니다. 이름과 핸들을 직접 적거나 다시 뽑아 주세요.",
    );
  });
});

describe("a moment told short", () => {
  const AT = "2026-11-10T14:02:11.000Z";

  it("gives the hour alone on the day it is read against, and the day with it on another", () => {
    // Read against its own day, whatever the zone of the machine: the hour and nothing else.
    const same = renderToStaticMarkup(<Time iso={AT} precision="clock" against={AT} />);
    expect(same).toMatch(
      /^<time class="sc-time" dateTime="2026-11-10T14:02:11\.000Z" title="[^"]+">\d{1,2}:\d{2}\s[AP]M<\/time>$/,
    );
    // Read against a day three days on, it says which day it was.
    const other = renderToStaticMarkup(
      <Time iso={AT} precision="clock" against="2026-11-13T14:02:11.000Z" />,
    );
    expect(other).toMatch(/>Nov (9|10|11), \d{1,2}:\d{2}\s[AP]M<\/time>$/);
    // Against nothing it is read against now, which this moment's day is not.
    expect(renderToStaticMarkup(<Time iso="2001-02-03T12:00:00.000Z" precision="clock" />)).toMatch(
      />Feb \d, \d{1,2}:\d{2}\s[AP]M</,
    );
    // The whole moment stays in the title, for whoever rests the pointer on it.
    expect(same).toContain('title="');
  });

  it("says a moment that is none as it came", () => {
    expect(renderToStaticMarkup(<Time iso="soon" precision="clock" />)).toBe(
      '<time class="sc-time">soon</time>',
    );
  });
});

describe("an agent account's page (ADR-0085, ADR-0086)", () => {
  const WHEN = "2026-11-10T14:02:11.000Z";
  /** Someone who manages nobody here. */
  const CAROL = "0199c4d8-0000-7000-8000-00000000000c";
  const mira: RestPerson = {
    ...bob,
    id: "0199c4d8-0000-7000-8000-000000000009",
    login: "acme-mira",
    name: "Mira",
    kind: "agent",
    handle: "mira",
    title: null,
    managerId: alice.id,
  };
  const standing = (
    state: "running" | "stopped" | "refused" | "failed" | "unheard",
    reason: string,
  ) => ({
    state,
    reason,
    since: WHEN,
    heardAt: WHEN,
  });
  const runner = {
    delivered: 8,
    latest: 10,
    session: null,
    machine: { name: "mac-mini", os: "Darwin 24.1.0", user: "mira" },
    runner: "0.5.0",
    product: { driver: "claude", name: "Claude Code", version: "2.1.0", tried: false },
    offers: {
      models: ["opus", "sonnet"],
      efforts: ["low", "high"],
      steer: true,
      images: true,
      resume: true,
    },
    running: { model: "opus", effort: null },
    settings: { model: "sonnet", effort: null },
  };
  const event = (n: number, over: object = {}) => ({
    n,
    kind: "assistant" as const,
    at: WHEN,
    text: `Event ${n}.`,
    whole: null,
    data: {},
    files: [],
    sealed: null,
    ...over,
  });
  const session = (over: object = {}) => ({
    id: "0199c4d8-0000-7000-8000-0000000000a1",
    month: "2026-11",
    startedAt: WHEN,
    endedAt: null,
    ended: null,
    product: { driver: "claude", name: "Claude Code", version: "2.1.0", tried: false },
    model: "opus",
    effort: null,
    resumed: false,
    machine: { name: "mac-mini", os: "Darwin 24.1.0", user: "mira" },
    events: 12,
    lastEventAt: WHEN,
    away: false,
    ...over,
  });

  it("says how an agent stands in a word, and why and since when where there is room", () => {
    expect(renderToStaticMarkup(<AgentStateBadge state={null} />)).toBe("");
    expect(renderToStaticMarkup(<AgentStateBadge state={undefined} full />)).toContain(
      "No runner has been heard from yet",
    );
    // Where there is room, it says so in a badge, as an account that stands somehow does.
    expect(renderToStaticMarkup(<AgentStateBadge state={null} full />)).toContain(">Not set up<");
    const brief = renderToStaticMarkup(<AgentStateBadge state={standing("running", "started")} />);
    expect(brief).toContain("sc-badge-success");
    expect(brief).toContain(">Running<");
    expect(brief).not.toContain("since");
    // An account at work carries the dot of what is at work this moment, where it is said in a
    // word and where there is room alike; no other state does.
    expect(brief).toContain("sc-badge-live");
    expect(
      renderToStaticMarkup(<AgentStateBadge state={standing("running", "started")} full />),
    ).toContain("sc-badge-live");
    const full = renderToStaticMarkup(
      <AgentStateBadge state={standing("refused", "model_refused")} full />,
    );
    expect(full).toContain("sc-badge-warning");
    expect(full).toContain(">Refused<");
    // Since when stands right after the badge, whose state it is the moment of; then why.
    expect(full).toMatch(
      />Refused<\/span><span class="sc-note">since <time[^>]*>[^<]+<\/time> · the model refused · runner last heard from/,
    );
    // A reason said later under the state that stayed carries its own moment, and the state
    // keeps since when it stands: neither is shown as the other's.
    const later = renderToStaticMarkup(
      <AgentStateBadge
        state={{
          ...standing("running", "completed"),
          since: "2026-11-08T08:41:00.000Z",
          reasonAt: "2026-11-10T14:02:11.000Z",
        }}
        full
      />,
    );
    expect(later).toMatch(
      /since <time[^>]*dateTime="2026-11-08T08:41:00\.000Z"[^>]*>[^<]+<\/time> · a turn completed \(<time[^>]*dateTime="2026-11-10T14:02:11\.000Z"[^>]*>[^<]+<\/time>\) · runner last heard from/,
    );
    // One the console keeps no moment for, a row of before, is shown with none.
    expect(
      renderToStaticMarkup(
        <AgentStateBadge state={{ ...standing("running", "reset"), reasonAt: null }} full />,
      ),
    ).toContain(" · it began a new conversation · runner last heard from");
    // A reason the page has no words for is said as it came, as text.
    expect(
      renderToStaticMarkup(<AgentStateBadge state={standing("failed", "<b>new</b>")} full />),
    ).toContain("&lt;b&gt;new&lt;/b&gt;");
    for (const [state, word, tone] of [
      ["stopped", "Stopped", "neutral"],
      ["failed", "Failed", "danger"],
      ["unheard", "Not heard from", "warning"],
    ] as const) {
      const seen = renderToStaticMarkup(<AgentStateBadge state={standing(state, "stop")} />);
      expect(seen).toContain(`>${word}<`);
      expect(seen).toContain(`sc-badge-${tone}`);
      expect(seen).not.toContain("sc-badge-live");
    }
    expect(full).not.toContain("sc-badge-live");
  });

  it("says on an account's card how much of its product's allowance is used and when each window resets (ADR-0156)", () => {
    const now = Date.parse("2026-11-24T03:00:00.000Z");
    const at = "2026-11-24T02:58:00.000Z";
    const usage = [
      { name: "5-hour", used: 0.42, resetsAt: "2026-11-24T05:00:00.000Z", at },
      { name: "weekly", used: 0.899, resetsAt: "2026-11-27T05:00:00.000Z", at },
      // Used up; one the product calls near its limit with no share; one whose reset has
      // passed, which says nothing of the window after it; and one of a name of its own.
      { name: "weekly opus", used: 1, resetsAt: null, at },
      { name: "primary", used: null, resetsAt: null, near: true, at },
      { name: "gone", used: 0.99, resetsAt: "2026-11-24T02:00:00.000Z", at },
      { name: "<b>bold</b>", used: 0.01, resetsAt: null, at },
    ];
    const card = (agent: Partial<RestAgent>): string =>
      renderToStaticMarkup(
        <AgentAccountList
          agents={[
            {
              person: mira,
              manager: alice,
              supervised: false,
              state: standing("running", "resumed"),
              ...agent,
            },
          ]}
          now={now}
        />,
      );
    const seen = card({ usage });
    expect(seen).toContain("<dt>Usage</dt>");
    // A window by the words a person has for it, the two every product has; another as it came.
    const label = (name: string) => `<span class="sc-progress-label">${name}</span>`;
    const figure = (words: string) => `<span class="sc-progress-figure">${words}</span>`;
    const bar = (width: string) =>
      `<svg class="sc-progress-track" aria-hidden="true" focusable="false"><rect class="sc-progress-used" width="${width}" height="100%"></rect></svg>`;
    expect(seen).toContain(label("5 hours"));
    expect(seen).toContain(label("Week"));
    expect(seen).toContain(label("Week (Opus)"));
    // A share as a bar and in whole hundredths, never more than was said: plain while there
    // is room, marked near the limit and at it. The bar is a picture of the figure beside it.
    expect(seen).toContain(
      `<div class="sc-progress"><div class="sc-progress-head">${label("5 hours")}<span class="sc-progress-note">resets <time class="sc-time" dateTime="2026-11-24T05:00:00.000Z"`,
    );
    expect(seen).toContain(`${figure("42%")}</div>${bar("42%")}`);
    expect(seen).toMatch(
      /<div class="sc-progress sc-progress-near"><div class="sc-progress-head"><span class="sc-progress-label">Week<\/span>.*?<span class="sc-progress-figure">89%<\/span>/,
    );
    expect(seen).toContain(
      `<div class="sc-progress sc-progress-full"><div class="sc-progress-head">${label("Week (Opus)")}${figure("100%")}</div>${bar("100%")}`,
    );
    // One the product calls near its limit without a share: the word, and no bar.
    expect(seen).toContain(
      `<div class="sc-progress sc-progress-near"><div class="sc-progress-head">${label("primary")}${figure("Near its limit")}</div></div>`,
    );
    // A window of a part of the allowance, one model's own, reads as the plan's window with
    // what it is of beside it; a name that only looks like one is shown as it came.
    const parts = card({
      usage: [
        { name: "weekly fable", used: 0.26, resetsAt: null, at },
        { name: "5-hour GPT-5.3-Codex-Spark", used: 0.1, resetsAt: null, at },
        { name: "weekly ", used: 0.2, resetsAt: null, at },
        { name: "monthly fable", used: 0.3, resetsAt: null, at },
        { name: "constructor fable", used: 0.4, resetsAt: null, at },
      ],
    });
    expect(parts).toContain(label("Week (Fable)"));
    expect(parts).toContain(label("5 hours (GPT-5.3-Codex-Spark)"));
    expect(parts).toContain(label("weekly "));
    expect(parts).toContain(label("monthly fable"));
    expect(parts).toContain(label("constructor fable"));
    // The word "used" is said nowhere: the figure under the fact's name says it.
    expect(seen).not.toContain("% used");
    // What is over is not shown, and a name is text, whatever it holds.
    expect(seen).not.toContain("gone");
    expect(seen).not.toContain("99%");
    expect(seen).toContain("&lt;b&gt;bold&lt;/b&gt;");
    expect(seen).not.toContain("<b>bold</b>");
    // The card stays short: when the product said so is on the account's page.
    expect(seen).not.toContain("as of ");
    // A name is what a runner sent: one that every object has is no word of the pack, and
    // draws as the text it is; two windows of one name are two lines.
    const hostile = card({
      usage: [
        { name: "__proto__", used: 0.1, resetsAt: null, at },
        { name: "constructor", used: 0.2, resetsAt: null, at },
        { name: "toString", used: 0.3, resetsAt: null, at },
        { name: "weekly", used: 0.4, resetsAt: null, at },
        { name: "weekly", used: 0.5, resetsAt: null, at },
      ],
    });
    expect(hostile).toContain(label("__proto__"));
    expect(hostile).toContain(label("constructor"));
    expect(hostile).toContain(label("toString"));
    expect(hostile.split(label("Week"))).toHaveLength(3);
    expect(hostile).toContain(figure("40%"));
    expect(hostile).toContain(figure("50%"));
    // Nothing of it where its runner said none, or where every window is over.
    expect(card({})).not.toContain("<dt>Usage</dt>");
    expect(card({ usage: [] })).not.toContain("<dt>Usage</dt>");
    expect(card({ usage: [usage[4] as (typeof usage)[number]] })).not.toContain("<dt>Usage</dt>");
    // Whoever supervises nothing reads it too: it says whom work can be given to now.
    expect(card({ usage, runner: null })).toContain(figure("42%"));
    // On the account's page, with when the product said so; and in Korean.
    const full = renderToStaticMarkup(<AgentUsage usage={usage.slice(0, 2)} said />);
    expect(full).toContain(
      `<span class="sc-progress-words">as of <time class="sc-time" dateTime="${at}"`,
    );
    expect(full.split("as of ")).toHaveLength(2);
    // The console keeps a window until its reset: where one was said days before another,
    // each says its own moment, so that the old one does not read as said just now.
    const old = "2026-11-21T02:58:00.000Z";
    const apart = renderToStaticMarkup(
      <AgentUsage
        usage={[
          { name: "5-hour", used: 0.42, resetsAt: "2026-11-24T05:00:00.000Z", at },
          { name: "weekly", used: 0.61, resetsAt: "2026-11-27T05:00:00.000Z", at: old },
        ]}
        said
      />,
    );
    expect(apart.split("as of ")).toHaveLength(3);
    expect(apart).toMatch(
      /<\/time> · as of <time class="sc-time" dateTime="2026-11-21T02:58:00.000Z"/,
    );
    expect(apart).toContain(`dateTime="${old}"`);
    expect(apart).toContain(`dateTime="${at}"`);
    const korean = renderToStaticMarkup(
      <LanguageContext.Provider value={KOREAN}>
        <AgentUsage usage={usage.slice(0, 2)} said />
      </LanguageContext.Provider>,
    );
    expect(korean).toContain(label("5시간"));
    expect(korean).toContain(label("주간"));
    expect(
      renderToStaticMarkup(
        <LanguageContext.Provider value={KOREAN}>
          <AgentUsage usage={[{ name: "weekly fable", used: 0.26, resetsAt: null, at }]} />
        </LanguageContext.Provider>,
      ),
    ).toContain(label("주간 (Fable)"));
    expect(korean).toContain(figure("42%"));
    expect(korean).not.toContain("사용");
    expect(korean).toContain("</time> 초기화");
    expect(korean).toContain("</time> 기준");
  });

  it("leads from the list of accounts to an account's page, with how it stands beside its name", () => {
    const seen = renderToStaticMarkup(
      <AgentAccountList
        agents={[
          { person: mira, manager: alice, supervised: true, state: standing("stopped", "stop") },
        ]}
        href={(agent) => `/agents/${agent.person.handle}`}
      />,
    );
    expect(seen).toContain('<a class="sc-agent-card-link" href="/agents/mira">Mira</a>');
    expect(seen).toContain("sc-agent-card-linked");
    expect(seen).toContain(">Stopped<");
  });

  it("reads the events of a session as the things a person reads: a tool's call with its answer, one thing", () => {
    const call = (n: number, id: string | undefined, tool = "execute") =>
      event(n, { kind: "tool_call", text: `run ${n}`, data: { tool, ...(id ? { id } : {}) } });
    const result = (n: number, id: string | undefined, error = false) =>
      event(n, { kind: "tool_result", text: `out ${n}`, data: { error, ...(id ? { id } : {}) } });
    const asked = (n: number, id: string) =>
      event(n, {
        kind: "permission",
        text: "Allowed.",
        data: { tool: "edit", id, answer: "allowed" },
      });
    const talk = talkOf([
      event(1, { kind: "person", text: "Go." }),
      event(2, { kind: "thinking", text: "Hm." }),
      call(3, "a"),
      result(4, "a"),
      // What was asked comes before the call it is about, and is the same thing.
      asked(5, "b"),
      call(6, "b", "edit"),
      result(7, "b", true),
      // Two calls under way at once, answered out of order.
      call(8, "c"),
      call(9, "d"),
      result(10, "d"),
      result(11, "c"),
      // An agent that numbers its calls anew at every turn: the same id is another call.
      call(12, "a"),
      event(13, { text: "Done." }),
      // With no id, an answer is the call's before it that waits; one with none before is alone.
      call(14, undefined),
      result(15, undefined),
      event(16, { kind: "status", text: "The product started." }),
      result(17, undefined),
      event(18, { kind: "wake", text: "ready", data: { key: "#412" } }),
      event(19, { kind: "error", text: "It fell over." }),
    ]);
    const shape = talk.map((one) =>
      one.type === "tool"
        ? `tool ${one.permission?.n ?? "-"}/${one.call?.n ?? "-"}/${one.result?.n ?? "-"}`
        : `${one.type} ${one.event.n}`,
    );
    expect(shape).toEqual([
      "told 1",
      "thought 2",
      "tool -/3/4",
      "tool 5/6/7",
      "tool -/8/11",
      "tool -/9/10",
      "tool -/12/-",
      "said 13",
      "tool -/14/15",
      "note 16",
      "tool -/-/17",
      "wake 18",
      "note 19",
    ]);
    // A sealed event is a note where it stood, whatever it was.
    expect(
      talkOf([event(1, { kind: "tool_call", sealed: { by: alice, at: WHEN, reason: "x" } })]),
    ).toMatchObject([{ type: "note" }]);
    expect(talkOf([])).toEqual([]);
  });

  it("reads what a sub-agent did under the call that started it, and labels what names a call the session does not hold", () => {
    const whose = { parent: "toolu_a1", subagent: "Explore" };
    const seen = renderToStaticMarkup(
      <TranscriptView
        agent={mira}
        events={[
          event(1, { text: "I will have it looked at." }),
          event(2, {
            kind: "tool_call",
            text: '{"subagent_type":"Explore","prompt":"Look."}',
            data: { tool: "Agent", id: "toolu_a1" },
          }),
          event(3, { kind: "thinking", text: "Where are they?", data: whose }),
          event(4, { text: "Looking in the **routes**.\n\nThen the tests.", data: whose }),
          event(5, {
            kind: "tool_call",
            text: "ls src",
            data: { tool: "Bash", id: "s1", ...whose },
          }),
          event(6, {
            kind: "tool_result",
            text: "rest.ts",
            data: { id: "s1", error: false, ...whose },
          }),
          // What the runner knew of only by the call, which the events do not hold: where it
          // stood, labelled, without a name.
          event(7, { text: "From another.", data: { parent: "toolu_a2" } }),
          // A name is text as everything of an event is, and is shown to a length.
          event(8, {
            kind: "thinking",
            text: "Hm.",
            data: { parent: "toolu_a3", subagent: `<b>${"n".repeat(200)}` },
          }),
          event(9, { kind: "tool_result", text: "Found.", data: { id: "toolu_a1", error: false } }),
          event(10, { kind: "error", text: "A request failed.", data: whose }),
          event(11, {
            kind: "error",
            text: "Another failed.",
            data: { parent: "toolu_a9", subagent: "Plan" },
          }),
        ]}
        fileHref={(id) => id}
      />,
    );
    // The agent's own word stands as it did, beside its picture.
    expect(seen).toContain('<li class="sc-talk-item sc-talk-said" data-n="1">');
    // The call that started the sub-agent is the sub-agent's row: what it is, what its events
    // call it where the call did not say, how it ended and how much it did.
    expect(seen).toContain(
      '<li class="sc-talk-item sc-talk-step sc-talk-tool" data-n="2"><details class="sc-talk-tool-fold"><summary class="sc-talk-tool-head sc-talk-agent-head"><span class="sc-name sc-talk-agent-name" title="Explore">Explore</span><span class="sc-badge sc-badge-neutral">Done</span>',
    );
    expect(seen).toContain(
      '<span class="sc-muted sc-talk-agent-facts"><span class="sc-talk-kind">Sub-agent</span>1 tool call · 0:00</span>',
    );
    // What it thought, said and called stand inside the row, a line each, with no label: whose
    // they are is said once, by the row.
    const inside = seen.slice(
      seen.indexOf('<ol class="sc-talk sc-talk-steps" aria-label="What the sub-agent did">'),
      seen.indexOf('data-n="7"'),
    );
    expect(inside).toContain(
      '<li class="sc-talk-item sc-talk-step sc-talk-thought" data-n="3"><details class="sc-talk-tool-fold"><summary class="sc-talk-tool-head"><span class="sc-talk-kind">Thought</span><span class="sc-talk-tool-line">Where are they?</span><time',
    );
    expect(inside).toContain(
      '<li class="sc-talk-item sc-talk-step sc-talk-thought" data-n="4"><details class="sc-talk-tool-fold"><summary class="sc-talk-tool-head"><span class="sc-talk-kind">Said</span><span class="sc-talk-tool-line">Looking in the routes.</span><time',
    );
    // What it said is not the agent's word to whoever reads, and is Markdown as the agent's is.
    expect(inside).toContain(
      '<div class="sc-prose"><p>Looking in the <strong>routes</strong>.</p>\n<p>Then the tests.</p></div>',
    );
    expect(seen).not.toContain('<li class="sc-talk-item sc-talk-said" data-n="4">');
    expect(inside).toContain(
      '<code class="sc-talk-tool-name">Bash</code><span class="sc-talk-tool-line">ls src</span><time',
    );
    expect(inside).not.toContain("sc-badge");
    // A row's line for what was said shows its first line without the marks of its Markdown.
    expect(saidLine("\n## A *heading*\nMore.")).toBe("A *heading*");
    expect(saidLine("- The `form` has **one** step.")).toBe("The form has one step.");
    expect(saidLine("> 1. quoted")).toBe("1. quoted");
    expect(saidLine("12. Twelfth")).toBe("Twelfth");
    expect(saidLine("")).toBe("");
    // A note of the sub-agent stands inside too, and says nothing of whose it is there.
    expect(inside).toContain('data-n="10"');
    expect(inside).not.toContain("sc-talk-fact");
    // What the sub-agent answered is the row's own, after what it did.
    expect(inside).toContain('<pre class="sc-talk-code sc-talk-code-answer">Found.</pre>');
    // An event of a call the events do not hold stays where it stood, under a label.
    expect(seen).toContain(
      '<span class="sc-talk-tool-line">From another.</span><span class="sc-badge sc-badge-neutral">Sub-agent</span>',
    );
    expect(seen).toContain(`Sub-agent: &lt;b&gt;${"n".repeat(37)}</span>`);
    expect(seen).not.toContain("<b>");
    // Such a note says whose it is as a fact, and never the id of the call.
    expect(seen).toContain('<span class="sc-talk-fact">sub-agent Plan</span>');
    expect(seen).not.toContain("toolu_a9</span>");
    expect(subagentOf(event(1, { data: { parent: 7, subagent: "x" } }))).toBeUndefined();
    expect(subagentOf(event(1, { data: { subagent: "x" } }))).toBeUndefined();
    expect(subagentOf(event(1, { data: { parent: "p", subagent: 7 } }))).toBe("");
    expect(subagentOf(undefined)).toBeUndefined();
    // In Korean too.
    const korean = renderToStaticMarkup(
      <LanguageContext.Provider value={KOREAN}>
        <TranscriptView
          events={[
            event(1, { text: "보는 중.", data: whose }),
            event(2, {
              kind: "tool_call",
              text: "{}",
              data: { tool: "Agent", id: "a", starts: "Explore: 경로 찾기" },
            }),
            event(3, {
              kind: "tool_call",
              text: "ls",
              data: { tool: "Bash", id: "b", parent: "a" },
            }),
            event(4, { kind: "tool_result", text: "ok", data: { id: "a", error: true } }),
          ]}
          fileHref={(id) => id}
        />
      </LanguageContext.Provider>,
    );
    expect(korean).toContain(">서브 에이전트: Explore<");
    expect(korean).toContain(
      '<span class="sc-name sc-talk-agent-name" title="Explore: 경로 찾기">Explore: 경로 찾기</span><span class="sc-badge sc-badge-danger">실패</span>',
    );
    expect(korean).toContain('<span class="sc-talk-kind">서브 에이전트</span>도구 호출 1회 · 0:00');
    expect(korean).toContain('aria-label="서브 에이전트가 한 일"');
  });

  it("reads the events of sub-agents that ran side by side each under its own call, a runner of before by what its events name", () => {
    const at = (seconds: number) => new Date(Date.parse(WHEN) + seconds * 1000).toISOString();
    const of = (parent: string, subagent?: string) =>
      subagent === undefined ? { parent } : { parent, subagent };
    const events = [
      event(1, { kind: "person", text: "Go.", at: at(0), data: { signal: 1 } }),
      // Two started at once: one by a runner that says so (`starts`), one a runner of before wrote.
      event(2, {
        kind: "tool_call",
        text: "{}",
        at: at(10),
        data: { tool: "Agent", id: "a1", starts: "Explore: Find the routes" },
      }),
      event(3, { kind: "tool_call", text: "{}", at: at(10), data: { tool: "Task", id: "a2" } }),
      // What they did arrives interleaved.
      event(4, { kind: "thinking", text: "Where?", at: at(12), data: of("a1", "x") }),
      event(5, {
        kind: "tool_call",
        text: "ls",
        at: at(13),
        data: { tool: "Bash", id: "s1", ...of("a2", "Read the spec") },
      }),
      event(6, {
        kind: "tool_call",
        text: "cat a",
        at: at(14),
        data: { tool: "Read", id: "s2", ...of("a1") },
      }),
      event(7, { kind: "tool_result", text: "a", at: at(15), data: { id: "s1", ...of("a2") } }),
      event(8, { kind: "tool_result", text: "b", at: at(20), data: { id: "s2", ...of("a1") } }),
      event(9, {
        kind: "tool_call",
        text: "grep x",
        at: at(22),
        data: { tool: "Grep", id: "s3", ...of("a1") },
      }),
      // An answer with no id looks for a call that waits in its own sub-agent's line, finds
      // none there, and never joins another's: the first one's Grep waits, and is left alone.
      event(10, { kind: "tool_result", text: "c", at: at(25), data: of("a2") }),
      event(11, { kind: "assistant", text: "Read.", at: at(26), data: of("a2") }),
      // An event of a call the events do not hold stays in the session's own line.
      event(12, { kind: "assistant", text: "Elsewhere.", at: at(27), data: of("gone") }),
      event(13, { kind: "tool_result", text: "Spec read.", at: at(40), data: { id: "a2" } }),
      event(14, { kind: "assistant", text: "One is back.", at: at(41) }),
    ];
    const shape = (items: ReturnType<typeof talkOf>): unknown[] =>
      items.map((one) =>
        one.type === "tool"
          ? [
              `tool ${one.call?.n ?? "-"}/${one.result?.n ?? "-"}`,
              ...(one.steps === undefined ? [] : [shape([...one.steps])]),
            ]
          : `${one.type} ${one.event.n}`,
      );
    const talk = talkOf(events);
    expect(shape(talk)).toEqual([
      "told 1",
      ["tool 2/-", ["thought 4", ["tool 6/8"], ["tool 9/-"]]],
      ["tool 3/13", [["tool 5/7"], ["tool -/10"], "said 11"]],
      "said 12",
      "said 14",
    ]);
    // What the record says of each: its name, how it stands, how long, how many tools, what at.
    const now = Date.parse(at(100));
    const [, first, second] = talk;
    expect(first && subAgentOf(first, { now, live: true })).toEqual({
      n: 2,
      name: "Explore: Find the routes",
      startedAt: at(10),
      state: "running",
      seconds: 90,
      calls: 2,
      at: { at: "tool", tool: "Grep" },
    });
    // A runner of before named it on its events alone; done, it ran until its answer.
    expect(second && subAgentOf(second, { now, live: true })).toEqual({
      n: 3,
      name: "Read the spec",
      startedAt: at(10),
      state: "done",
      seconds: 30,
      calls: 1,
      at: undefined,
    });
    // A session that is not open has none running: it is ended, where the last thing it did was.
    expect(first && subAgentOf(first, { now, live: false })).toMatchObject({
      state: "ended",
      seconds: 12,
      at: undefined,
    });
    expect(subAgentOf({ type: "said", event: event(1) }, { now, live: true })).toBeUndefined();
    expect(talk[0] && subAgentOf(talk[0], { now, live: true })).toBeUndefined();
    // The foot's list: those at work in the turn under way, in the order they were started.
    expect(atWorkOf(events, now).map((one) => [one.name, one.calls, one.seconds])).toEqual([
      ["Explore: Find the routes", 2, 90],
    ]);
    expect(atWorkOf(events.slice(0, 3), now).map((one) => [one.name, one.at])).toEqual([
      ["Explore: Find the routes", { at: "working" }],
    ]);
    // What the agent itself is at is the call that started them, whatever they do meanwhile.
    expect(workingOf(events.slice(0, 9))).toEqual({ at: "tool", tool: "Task" });
    // A turn that ended ends every sub-agent still open in it, there; one started after is another turn's.
    const done = event(15, {
      kind: "status",
      text: "The turn completed.",
      at: at(60),
      data: { turn: "completed" },
    });
    const ended = talkOf([...events, done])[1];
    expect(ended && subAgentOf(ended, { now, live: true })).toMatchObject({
      state: "ended",
      seconds: 50,
      at: undefined,
    });
    expect(atWorkOf([...events, done], now)).toEqual([]);
    const next = [
      ...events,
      done,
      event(16, { kind: "wake", text: "", at: at(70), data: { signal: 2 } }),
      event(17, {
        kind: "tool_call",
        text: "{}",
        at: at(80),
        data: { tool: "Agent", id: "a1", starts: "Plan" },
      }),
      event(18, { kind: "thinking", text: "Hm.", at: at(85), data: of("a1") }),
    ];
    // An id used again is another call, with a sub-agent of its own.
    expect(atWorkOf(next, now).map((one) => [one.n, one.name, one.at])).toEqual([
      [17, "Plan", { at: "thinking" }],
    ]);
    expect(shape(talkOf(next)).slice(-2)).toEqual(["wake 16", ["tool 17/-", ["thought 18"]]]);
    // A failed answer, and one whose call was refused: neither is at work.
    const failed = talkOf([
      event(1, { kind: "tool_call", text: "{}", at: at(0), data: { id: "f", starts: "x" } }),
      event(2, { kind: "tool_result", text: "no", at: at(7), data: { id: "f", error: true } }),
      event(3, { kind: "tool_call", text: "{}", at: at(8), data: { id: "r", starts: "y" } }),
      event(4, { kind: "permission", text: "", at: at(9), data: { id: "r", answer: "denied" } }),
    ]);
    expect(failed.map((one) => subAgentOf(one, { now, live: true })?.state)).toEqual([
      "failed",
      "ended",
    ]);
    expect(clockOf(0)).toBe("0:00");
    expect(clockOf(67)).toBe("1:07");
    expect(clockOf(3725)).toBe("1:02:05");
    expect(clockOf(Number.NaN)).toBe("0:00");
  });

  it("reads a sub-agent that goes on in the background as at work until its own line says it ended, whatever turn ended meanwhile", () => {
    const at = (seconds: number) => new Date(Date.parse(WHEN) + seconds * 1000).toISOString();
    const of = { parent: "b1", subagent: "general-purpose: Count the fixtures" };
    const turn = (n: number, seconds: number) =>
      event(n, {
        kind: "status",
        text: "The turn completed.",
        at: at(seconds),
        data: { turn: "completed" },
      });
    const events = [
      event(1, { kind: "person", text: "Go.", at: at(0), data: { signal: 1 } }),
      event(2, {
        kind: "tool_call",
        text: "{}",
        at: at(10),
        data: { tool: "Agent", id: "b1", starts: of.subagent },
      }),
      // Answered at once, with the word that it was started and goes on.
      event(3, {
        kind: "tool_result",
        text: "Async agent launched successfully.",
        at: at(11),
        data: { id: "b1", error: false, background: true },
      }),
      event(4, { kind: "assistant", text: "Started.", at: at(12) }),
      turn(5, 13),
      // What it does comes after the turn that started it is over.
      event(6, {
        kind: "tool_call",
        text: "ls",
        at: at(20),
        data: { tool: "Bash", id: "s1", ...of },
      }),
      event(7, { kind: "tool_result", text: "two", at: at(21), data: { id: "s1", ...of } }),
      event(8, {
        kind: "tool_call",
        text: "wc",
        at: at(30),
        data: { tool: "Bash", id: "s2", ...of },
      }),
    ];
    const now = Date.parse(at(100));
    const row = (all: Parameters<typeof talkOf>[0]) => {
      const one = talkOf(all)[1];
      return one === undefined ? undefined : subAgentOf(one, { now, live: true });
    };
    // Not done by its call's answer, and not ended by the turn's end: at work, by what it does.
    expect(row(events)).toEqual({
      n: 2,
      name: of.subagent,
      startedAt: at(10),
      state: "running",
      seconds: 90,
      calls: 2,
      at: { at: "tool", tool: "Bash" },
    });
    // The agent's own turn is over, and its sub-agent is at work all the same.
    expect(workingOf(events)).toBeUndefined();
    expect(atWorkOf(events, now).map((one) => [one.n, one.name, one.calls])).toEqual([
      [2, of.subagent, 2],
    ]);
    // Another turn of the agent's, begun and ended meanwhile, ends nothing of it.
    const later = [
      ...events,
      event(9, { kind: "wake", text: "", at: at(40), data: { signal: 2 } }),
      event(10, { kind: "assistant", text: "Noted.", at: at(41) }),
      turn(11, 42),
    ];
    expect(row(later)?.state).toBe("running");
    expect(atWorkOf(later, now)).toHaveLength(1);
    // Its own line says when it ended: done from there, with how long it ran until then.
    const over = (n: number, seconds: number, how: string) =>
      event(n, {
        kind: "status",
        text: "The sub-agent is done.",
        at: at(seconds),
        data: { ...of, over: how },
      });
    const done = [
      ...later,
      event(12, { kind: "tool_result", text: "2", at: at(50), data: { id: "s2", ...of } }),
      over(13, 51, "completed"),
    ];
    expect(row(done)).toMatchObject({ state: "done", seconds: 41, calls: 2, at: undefined });
    expect(atWorkOf(done, now)).toEqual([]);
    expect(row([...later, over(12, 51, "failed")])?.state).toBe("failed");
    expect(row([...later, over(12, 51, "stopped")])?.state).toBe("ended");
    // Its word that it ended stands inside its row, and whose it is and how are not said twice.
    const note = renderToStaticMarkup(<TranscriptView events={done} fileHref={(id) => id} live />);
    expect(note).toContain(
      `<span class="sc-name sc-talk-agent-name" title="${of.subagent}">${of.subagent}</span><span class="sc-badge sc-badge-neutral">Done</span>`,
    );
    expect(note).toMatch(
      /data-n="13"><span class="sc-talk-note-line"><span class="sc-talk-kind">Status<\/span><span>The sub-agent is done\.<\/span>/,
    );
    // One started again does something after its word that it ended: at work again, until
    // it says so again.
    const again = [
      ...done,
      event(14, {
        kind: "tool_call",
        text: "ls",
        at: at(60),
        data: { tool: "Bash", id: "s3", ...of },
      }),
    ];
    expect(row(again)).toMatchObject({ state: "running", calls: 3, seconds: 90 });
    expect(row([...again, over(15, 70, "completed")])).toMatchObject({
      state: "done",
      seconds: 60,
    });
    // The session's end ends one still at work, there; a session that is not open has none.
    const ended = [
      ...later,
      event(12, {
        kind: "status",
        text: "The session ended.",
        at: at(45),
        data: { ended: "stopped" },
      }),
    ];
    expect(row(ended)).toMatchObject({ state: "ended", seconds: 35 });
    expect(atWorkOf(ended, now)).toEqual([]);
    const first = talkOf(later)[1];
    expect(first && subAgentOf(first, { now, live: false })).toMatchObject({
      state: "ended",
      seconds: 20,
    });
    // One whose start failed was answered with an error, and no word that it goes on.
    const refused = talkOf([
      event(1, { kind: "tool_call", text: "{}", at: at(0), data: { id: "f", starts: "x" } }),
      event(2, { kind: "tool_result", text: "no", at: at(1), data: { id: "f", error: true } }),
      turn(3, 2),
    ]);
    expect(refused[0] && subAgentOf(refused[0], { now, live: true })?.state).toBe("failed");
    // One in the foreground says it ended just before its call is answered: by the answer, as before.
    const fore = [
      event(1, { kind: "tool_call", text: "{}", at: at(0), data: { id: "f1", starts: "y" } }),
      event(2, {
        kind: "status",
        text: "The sub-agent is done.",
        at: at(5),
        data: { parent: "f1", subagent: "y", over: "completed" },
      }),
    ];
    const fored = (all: Parameters<typeof talkOf>[0]) => {
      const one = talkOf(all)[0];
      return one === undefined ? undefined : subAgentOf(one, { now, live: true });
    };
    expect(fored(fore)).toMatchObject({ state: "done", seconds: 5 });
    expect(
      fored([
        ...fore,
        event(3, { kind: "tool_result", text: "no", at: at(6), data: { id: "f1", error: true } }),
      ]),
    ).toMatchObject({ state: "failed", seconds: 6 });
    // A word that is none, and a sealed one, say nothing of an end.
    expect(
      row([
        ...events,
        event(9, { kind: "status", text: "x", at: at(40), data: { ...of, over: 1 } }),
      ])?.state,
    ).toBe("running");
    expect(
      row([
        ...done.slice(0, -1),
        event(13, {
          kind: "status",
          at: at(51),
          data: { ...of, over: "completed" },
          sealed: { by: alice, at: WHEN, reason: "x" },
        }),
      ])?.state,
    ).toBe("running");
  });

  it("reads a sub-agent that was stopped in the middle of a call as stopped, one started again as at work, and one a sub-agent started past that one's end", () => {
    const of = (parent: string) => ({ parent, subagent: parent });
    const starts = (n: number, id: string, more: object = {}) =>
      event(n, { kind: "tool_call", text: "{}", data: { tool: "Agent", id, starts: id, ...more } });
    const goesOn = (n: number, id: string, more: object = {}) =>
      event(n, { kind: "tool_result", data: { id, error: false, background: true, ...more } });
    const over = (n: number, parent: string, how: string) =>
      event(n, { kind: "status", text: "x", data: { ...of(parent), over: how } });
    const turn = (n: number) =>
      event(n, { kind: "status", text: "The turn completed.", data: { turn: "completed" } });
    const names = (all: Parameters<typeof talkOf>[0]) =>
      atWorkOf(all, Date.parse(WHEN)).map((one) => one.name);
    // Stopped in the middle of a call, as a product says it: that the sub-agent ended first, and
    // then what became of the call. Nothing of that is work, and no turn changes it.
    const stopped = [
      starts(1, "b1"),
      goesOn(2, "b1"),
      turn(3),
      event(4, { kind: "tool_call", text: "make", data: { id: "s1", ...of("b1") } }),
      over(5, "b1", "stopped"),
      event(6, { kind: "tool_result", text: "no", data: { id: "s1", error: true, ...of("b1") } }),
      event(7, { kind: "permission", text: "no", data: { answer: "denied", ...of("b1") } }),
      turn(8),
    ];
    expect(names(stopped)).toEqual([]);
    const first = talkOf(stopped)[0];
    expect(first && subAgentOf(first, { now: Date.parse(WHEN), live: true })?.state).toBe("ended");
    // Its own word that it was started again, before anything it does: at work from there.
    const again = [
      ...stopped,
      event(9, { kind: "status", text: "The sub-agent was started again.", data: of("b1") }),
      turn(10),
    ];
    expect(names(again)).toEqual(["b1"]);
    expect(names([...again, over(11, "b1", "completed")])).toEqual([]);
    // One a sub-agent started in the background goes on past the end of that one.
    const nested = [
      starts(1, "b1"),
      goesOn(2, "b1"),
      starts(3, "n1", of("b1")),
      goesOn(4, "n1", of("b1")),
      over(5, "b1", "completed"),
      turn(6),
    ];
    expect(names(nested)).toEqual(["n1"]);
    expect(names([...nested, over(7, "n1", "completed")])).toEqual([]);
  });

  it("says whether the events read hold a sub-agent's work without the call that started it", () => {
    const call = event(1, { kind: "tool_call", text: "{}", data: { tool: "Agent", id: "a1" } });
    const step = event(2, { kind: "tool_call", text: "ls", data: { id: "s1", parent: "a1" } });
    expect(lacksStarter([])).toBe(false);
    expect(lacksStarter([call, step])).toBe(false);
    // The call stands before the events read: what the sub-agent did is there without it.
    expect(lacksStarter([step])).toBe(true);
    expect(lacksStarter([call, event(3, { kind: "assistant", data: { parent: "gone" } })])).toBe(
      true,
    );
    // An event of the session's own names no call, and what is no id names none.
    expect(lacksStarter([event(4, { kind: "assistant" }), event(5, { data: { parent: 7 } })])).toBe(
      false,
    );
    // A call a sub-agent made is a call too: what the one it started did stands under it.
    expect(lacksStarter([call, step, event(6, { kind: "thinking", data: { parent: "s1" } })])).toBe(
      false,
    );
  });

  it("shows a session as a conversation, and nothing an agent's product printed as HTML", () => {
    const picture = {
      id: "0199c4d8-0000-7000-8000-0000000000f1",
      name: "screen.png",
      size: 2048,
      contentType: "image/png",
    };
    const sheet = {
      id: "0199c4d8-0000-7000-8000-0000000000f2",
      name: "export.csv",
      size: 55,
      contentType: "text/csv",
    };
    const seen = renderToStaticMarkup(
      <TranscriptView
        agent={mira}
        events={[
          event(1, {
            kind: "person",
            text: "Hold the release.",
            data: {
              signal: 3,
              kind: "interrupt",
              by: "alice",
              agent: "Claude Code",
              key: null,
              files: "export.csv",
              unseen: "screen.png",
            },
            files: [picture],
          }),
          event(2, { text: "<script>alert(1)</script>\n  [x](javascript:alert(1))" }),
          event(3, {
            kind: "tool_call",
            text: "ls -la\nsecond line",
            data: { tool: "Bash", id: "t1" },
          }),
          event(4, {
            kind: "tool_result",
            text: "The beginning",
            whole: 60_000,
            data: { id: "t1", error: true },
          }),
          event(5, { kind: "tool_result", text: "", files: [picture] }),
          event(6, { text: "", sealed: { by: alice, at: WHEN, reason: "A token in it." } }),
          event(7, { kind: "thinking", text: "First thought.\nSecond line." }),
          event(8, { kind: "status", text: "The product started.", data: { model: "opus" } }),
        ]}
        fileHref={(id) => `/api/v1/agents/mira/sessions/s/files/${id}`}
        signalFiles={(number) => (number === 3 ? [picture, sheet] : undefined)}
        signalFileHref={(number, id) => `/api/v1/agents/mira/signals/${number}/files/${id}`}
        onReadWhole={async () => "whole"}
      />,
    );
    // What the agent was told: who said it and through what, what kind of signal it was where
    // it was more than a tell, its words, its picture, and the file that is no picture, to save
    // from the signal's own address.
    expect(seen).toContain('<li class="sc-talk-item sc-talk-told" data-n="1">');
    // Who said it stands under the words, as in a chat, and not within them.
    expect(seen).toMatch(
      /<\/div><div class="sc-talk-meta sc-fine"><span class="sc-name">alice<\/span><span>through Claude Code<\/span>/,
    );
    expect(seen).toMatch(/<span class="sc-badge sc-badge-neutral">Interrupt<\/span>/);
    expect(seen).toContain('<pre class="sc-talk-text">Hold the release.</pre>');
    expect(seen).toContain(
      '<a href="/api/v1/agents/mira/signals/3/files/0199c4d8-0000-7000-8000-0000000000f2" download="export.csv">export.csv</a>',
    );
    // A picture is shown, never offered among the files to save.
    expect(seen).not.toContain('download="screen.png"');
    // What its product was not shown as a picture is said to whoever sent it.
    expect(seen).toContain(
      "Not shown to the agent as a picture, since its product takes none: handed over as a file in its desk (screen.png).",
    );
    // What the agent said, beside its picture: Markdown, whose raw HTML stays text and whose
    // link that would run something leads nowhere.
    expect(seen).toContain('<li class="sc-talk-item sc-talk-said" data-n="2">');
    expect(seen).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(seen).toContain("<span>x</span>");
    expect(seen).not.toContain("<script>");
    expect(seen).not.toContain('href="javascript:');
    expect(seen).toMatch(
      /<li class="sc-talk-item sc-talk-said" data-n="2"><(?:img|span) class="[^"]*sc-avatar/,
    );
    // A tool's call and its answer are one row that opens: the tool, the first line of what it
    // was called with, that it failed; inside, the call and the answer, cut where it was long.
    expect(seen).toContain(
      '<li class="sc-talk-item sc-talk-step sc-talk-tool sc-talk-tool-failed" data-n="3">',
    );
    expect(seen).toContain(
      '<code class="sc-talk-tool-name">Bash</code><span class="sc-talk-tool-line">ls -la</span>',
    );
    expect(seen).toMatch(/<span class="sc-badge sc-badge-danger">Failed<\/span>/);
    expect(seen).toContain('<pre class="sc-talk-code">ls -la\nsecond line</pre>');
    expect(seen).toContain('<pre class="sc-talk-code sc-talk-code-answer">The beginning</pre>');
    expect(seen).toContain("The beginning of 59 KB.");
    expect(seen).toContain(">Read it whole<");
    // A picture a tool returned stands under its row, seen without opening it, and opens
    // large over the page as every picture of the console does.
    expect(seen).toContain(
      '<button type="button" class="sc-picture-thumb" aria-label="Open the picture screen.png"><img src="/api/v1/agents/mira/sessions/s/files/0199c4d8-0000-7000-8000-0000000000f1" alt="screen.png"',
    );
    expect(seen).not.toContain('target="_blank"');
    expect(seen).toContain("Sealed by Alice Example: A token in it.");
    // A thought is folded to its first line; a status is a note with what the runner said of it.
    expect(seen).toContain(
      '<span class="sc-talk-kind">Thought</span><span class="sc-talk-tool-line">First thought.</span>',
    );
    expect(seen).toContain('<span class="sc-talk-kind">Status</span>');
    expect(seen).toContain('<span class="sc-talk-fact">model opus</span>');
    expect(seen.match(/<li class="sc-talk-item/g)).toHaveLength(7);
    // A call still under way says so; one that was refused says that, and is no failure of a tool.
    const waits = renderToStaticMarkup(
      <TranscriptView
        events={[
          event(1, { kind: "tool_call", text: "sleep 60", data: { tool: "Bash", id: "w" } }),
          event(2, {
            kind: "permission",
            text: "Refused.",
            data: { tool: "edit", id: "x", answer: "denied" },
          }),
        ]}
        fileHref={(id) => id}
      />,
    );
    expect(waits).toContain(">running<");
    expect(waits).toMatch(/<span class="sc-badge sc-badge-warning">Refused<\/span>/);
    // Where the page has not read the account's record, the other files are named, with no link.
    const named = renderToStaticMarkup(
      <TranscriptView
        events={[
          event(1, { kind: "person", text: "See.", data: { signal: 4, files: "a.csv, b.pdf" } }),
        ]}
        fileHref={(id) => id}
      />,
    );
    expect(named).toContain("Files: a.csv, b.pdf");
    expect(named).not.toContain("download=");
    expect(
      renderToStaticMarkup(<TranscriptView events={[]} fileHref={() => ""} empty={<p>none</p>} />),
    ).toBe("<p>none</p>");
    // What stands at the foot is there with no event too: words that wait for a first session.
    expect(
      renderToStaticMarkup(
        <TranscriptView
          events={[]}
          fileHref={() => ""}
          empty={<p>none</p>}
          foot={<li>waits</li>}
        />,
      ),
    ).toBe(
      '<p>none</p><ol class="sc-talk" aria-label="What the agent is doing"><li>waits</li></ol>',
    );
  });

  it("says what the record names in words of its own in the words of the page", () => {
    const events = [
      event(1, {
        kind: "wake",
        text: "A task was assigned.",
        data: { signal: 2, source: "board", key: "task.assigned", origin: "the feed" },
      }),
      event(2, { kind: "permission", text: "", data: { tool: "edit", id: "p", answer: "denied" } }),
      event(3, {
        kind: "person",
        text: "Go on.",
        data: { signal: 3, kind: "restart", by: "alice" },
      }),
      event(4, { kind: "status", text: "", data: { constructor: "x", model: "opus" } }),
      event(5, {
        kind: "permission",
        text: "",
        data: { tool: "edit", id: "q", answer: "postponed" },
      }),
    ];
    const korean = renderToStaticMarkup(
      <LanguageContext.Provider value={KOREAN}>
        <TranscriptView events={events} fileHref={(id) => id} />
      </LanguageContext.Provider>,
    );
    // A fact is called by the page's word for it, an answer is said in the page's language, and
    // a signal's kind is the word the conversation has for it.
    expect(korean).toContain('<span class="sc-talk-fact">출처 board</span>');
    expect(korean).toContain('<span class="sc-talk-fact">대상 task.assigned</span>');
    expect(korean).toContain('<span class="sc-talk-fact">모델 opus</span>');
    expect(korean).toContain("권한 · 거절됨");
    expect(korean).toMatch(/<span class="sc-badge sc-badge-neutral">재시작<\/span>/);
    expect(korean).not.toContain("source board");
    expect(korean).not.toContain("· denied");
    // What a newer runner writes, which the pack has no word for, stands as it came; and a
    // name every object has is no word of the pack, whatever a runner sends.
    expect(korean).toContain('<span class="sc-talk-fact">origin the feed</span>');
    expect(korean).toContain('<span class="sc-talk-fact">constructor x</span>');
    expect(korean).toContain("권한 · postponed");
    const english = renderToStaticMarkup(<TranscriptView events={events} fileHref={(id) => id} />);
    expect(english).toContain('<span class="sc-talk-fact">from board</span>');
    expect(english).toContain('<span class="sc-talk-fact">about task.assigned</span>');
    expect(english).toContain("Permission · denied");
    expect(wordOf({ stop: "Stop" }, "stop")).toBe("Stop");
    expect(wordOf({ stop: "Stop" }, "set")).toBe("set");
    expect(wordOf({ stop: "Stop" }, "toString")).toBe("toString");
  });

  it("says where a turn ended and how long it took, who stopped one with no words, and what was never read", () => {
    const at = (seconds: number) => new Date(Date.parse(WHEN) + seconds * 1000).toISOString();
    const seen = renderToStaticMarkup(
      <TranscriptView
        events={[
          event(1, { kind: "person", text: "Count them.", at: at(0), data: { signal: 1 } }),
          event(2, { text: "Six.", at: at(40) }),
          event(3, {
            kind: "status",
            text: "The turn completed.",
            at: at(133),
            data: { turn: "completed" },
          }),
          event(4, {
            kind: "person",
            text: "",
            at: at(200),
            data: { signal: 3, kind: "interrupt", by: "alice" },
          }),
          event(5, {
            kind: "person",
            text: "And the refunds?",
            at: at(201),
            data: { signal: 2, by: "alice", unread: true },
          }),
          event(6, {
            kind: "status",
            text: "The turn completed.",
            at: at(202),
            data: { turn: "completed" },
          }),
        ]}
        fileHref={(id) => id}
      />,
    );
    // A turn's end is a line of its own, with how long the agent was at it, and no note of a status.
    expect(seen).toContain('<li class="sc-talk-item sc-talk-turn" data-n="3">');
    expect(seen).toContain("Done in 2m 13s");
    expect(seen).not.toContain("The turn completed.");
    expect(seen).toContain("Done in 2s");
    // An interrupt with no words is who stopped the turn, and no message.
    expect(seen).toContain('<li class="sc-talk-item sc-talk-note sc-fine" data-n="4">');
    expect(seen).toContain("alice interrupted, so that what waited is read now.");
    // What the session ended on before the agent took it says so.
    expect(seen).toContain(
      '<p class="sc-talk-note-line sc-talk-unread">The session ended before the agent read this.</p>',
    );
    expect(seen.match(/sc-talk-unread/g)).toHaveLength(1);
    const korean = renderToStaticMarkup(
      <LanguageContext.Provider value={KOREAN}>
        <TranscriptView
          events={[
            event(1, { kind: "person", text: "세어 주세요.", at: at(0), data: { signal: 1 } }),
            event(2, {
              kind: "status",
              text: "The turn completed.",
              at: at(45),
              data: { turn: "completed" },
            }),
          ]}
          fileHref={(id) => id}
        />
      </LanguageContext.Provider>,
    );
    expect(korean).toContain("45초 만에 마침");
    // How a session ended is said by the note's words, and not again as a fact beside them.
    const over = renderToStaticMarkup(
      <TranscriptView
        events={[
          event(1, {
            kind: "status",
            text: "The session ended: stopped.",
            data: { ended: "stopped" },
          }),
        ]}
        fileHref={(id) => id}
      />,
    );
    expect(over).toContain("<span>The session ended: stopped.</span>");
    expect(over).not.toContain("sc-talk-fact");
  });

  it("draws a line again only when what it shows changed, however many events arrive", () => {
    const hands: TalkHands = {
      fileHref: (id) => id,
      signalFileHref: undefined,
      readWhole: () => undefined,
      openPicture: () => undefined,
    };
    const files = [{ id: "f1", name: "notes.txt", size: 12, contentType: "text/plain" }];
    const linesOf = (
      events: Parameters<typeof talkOf>[0],
      over: Partial<Parameters<typeof talkLinesOf>[0]> = {},
    ) =>
      talkLinesOf({
        items: talkOf(events),
        hands,
        agent: mira,
        began: turnStarts(events),
        // The record is read again every few seconds: the same files, in a list made anew.
        signalFiles: (number) => (number === 4 ? files.map((file) => ({ ...file })) : undefined),
        whole: NO_WHOLE,
        of: "session",
        reading: undefined,
        today: "2026-11-14",
        ...over,
      });
    const session = [
      event(1, { kind: "person", text: "Go.", data: { signal: 4 } }),
      event(2, { kind: "thinking", text: "Hm." }),
      event(3, { kind: "tool_call", text: "ls", data: { tool: "Bash", id: "t1" } }),
      event(4, { kind: "tool_result", text: "a b", data: { id: "t1" } }),
      event(5, { kind: "assistant", text: "Done.", whole: 4096 }),
      event(6, { kind: "status", text: "", data: { turn: "completed" } }),
      event(7, { kind: "tool_call", text: "pwd", data: { tool: "Bash", id: "t2" } }),
    ];
    const before = linesOf(session);
    expect(before.map((line) => line.key)).toEqual([1, 2, 3, 5, 6, 7]);
    // An event arrives: every line there was says the same and is not drawn again; the things
    // of the session are made anew each time, and the same events are the same line.
    const answer = event(8, { kind: "tool_result", text: "/home", data: { id: "t2" } });
    const after = linesOf([...session, answer, event(9, { kind: "assistant", text: "Here." })]);
    expect(after.map((line) => line.key)).toEqual([1, 2, 3, 5, 6, 7, 9]);
    const same = (a: typeof before, b: typeof before) =>
      a.map((line, index) => {
        const other = b[index];
        return other !== undefined && sameLine(line, other);
      });
    // All but the call that was answered, which now shows its answer.
    expect(same(before, after)).toEqual([true, true, true, true, true, false]);
    // A text read whole, and one being read, change the line they are of and no other.
    const whole = { of: "session", texts: { 5: "Done, at length." } };
    expect(same(before, linesOf(session, { whole }))).toEqual([
      true,
      true,
      true,
      false,
      true,
      true,
    ]);
    expect(same(before, linesOf(session, { reading: 4 }))).toEqual([
      true,
      true,
      false,
      true,
      true,
      true,
    ]);
    // A text read in another session is no text of this one: nothing changes.
    expect(same(before, linesOf(session, { whole: { ...whole, of: "another" } }))).toEqual(
      before.map(() => true),
    );
    // The account's picture stands beside what it said alone, so another picture draws that line.
    expect(same(before, linesOf(session, { agent: { ...mira } }))).toEqual([
      true,
      true,
      true,
      false,
      true,
      true,
    ]);
    // Other files of the signal draw the line they came with; a new day, new hands and a turn
    // that began at another moment draw what shows them.
    expect(
      same(
        before,
        linesOf(session, { signalFiles: () => [{ ...files[0], id: "f2" }] as typeof files }),
      ),
    ).toEqual([false, true, true, true, true, true]);
    expect(same(before, linesOf(session, { today: "2026-11-15" }))).toEqual(
      before.map(() => false),
    );
    expect(same(before, linesOf(session, { hands: { ...hands } }))).toEqual(
      before.map(() => false),
    );
    expect(
      same(before, linesOf(session, { began: new Map([[6, "2026-11-14T02:00:00.000Z"]]) })),
    ).toEqual([true, true, true, true, false, true]);
  });

  it("draws a sub-agent's row again when what it did changed, and each of its lines only when that line did", () => {
    const hands: TalkHands = {
      fileHref: (id) => id,
      signalFileHref: undefined,
      readWhole: () => undefined,
      openPicture: () => undefined,
    };
    const linesOf = (
      events: Parameters<typeof talkOf>[0],
      over: Partial<Parameters<typeof talkLinesOf>[0]> = {},
    ) =>
      talkLinesOf({
        items: talkOf(events),
        hands,
        agent: mira,
        began: turnStarts(events),
        signalFiles: undefined,
        whole: NO_WHOLE,
        of: "session",
        reading: undefined,
        today: "2026-11-14",
        live: true,
        ...over,
      });
    const whose = { parent: "a1", subagent: "Explore" };
    const session = [
      event(1, { kind: "tool_call", text: "{}", data: { tool: "Agent", id: "a1" } }),
      event(2, { kind: "thinking", text: "Hm.", data: whose }),
      event(3, { kind: "assistant", text: "Looking.", data: whose }),
      event(4, { kind: "tool_call", text: "ls", data: { tool: "Bash", id: "s1", ...whose } }),
      event(5, { kind: "assistant", text: "Mine." }),
      event(6, { kind: "assistant", text: "Whose?", data: { parent: "gone" } }),
    ];
    const before = linesOf(session);
    type Lines = typeof before;
    const same = (a: Lines, b: Lines) =>
      a.map((line, index) => {
        const other = b[index];
        return other !== undefined && sameLine(line, other);
      });
    // The session's own line holds the sub-agent's row and what the agent said; what the
    // sub-agent did is the row's, a line each, each told that it stands inside.
    expect(before.map((line) => line.key)).toEqual([1, 5, 6]);
    const stepsOf = (lines: Lines): Lines => [...(lines[0]?.steps ?? [])];
    expect(stepsOf(before).map((line) => [line.key, line.inside])).toEqual([
      [2, true],
      [3, true],
      [4, true],
    ]);
    expect(before.map((line) => [line.live, line.inside, line.steps?.length])).toEqual([
      [true, undefined, 3],
      [undefined, undefined, undefined],
      [undefined, undefined, undefined],
    ]);
    // More of the sub-agent arrives: its row is drawn again, since it counts what it did; the
    // lines there were say the same, but for the call that was answered; no other line is drawn.
    const after = linesOf([
      ...session,
      event(7, { kind: "tool_result", text: "a b", data: { id: "s1", ...whose } }),
      event(8, { kind: "assistant", text: "Found.", data: whose }),
    ]);
    expect(after.map((line) => line.key)).toEqual([1, 5, 6]);
    expect(same(before, after)).toEqual([false, true, true]);
    expect(stepsOf(after).map((line) => line.key)).toEqual([2, 3, 4, 8]);
    expect(same(stepsOf(before), stepsOf(after))).toEqual([true, true, false]);
    // Nothing arrives: the row and all of it say the same, however often the events are read.
    expect(same(before, linesOf([...session]))).toEqual([true, true, true]);
    // Something of the session's own arrives: the row is not drawn again.
    expect(same(before, linesOf([...session, event(7, { text: "More." })]))).toEqual([
      true,
      true,
      true,
    ]);
    // A session that is no longer one whose agent is at work draws the row, which then runs no more.
    expect(same(before, linesOf(session, { live: false }))).toEqual([false, true, true]);
    // The turn ended with the sub-agent open: its row is drawn again, to say so.
    const ended = linesOf([
      ...session,
      event(7, { kind: "status", text: "", data: { turn: "completed" } }),
    ]);
    expect(same(before, ended).slice(0, 3)).toEqual([false, true, true]);
    // What a sub-agent said is a step with no picture beside it: another picture of the account
    // draws the account's own word again, and no line of a sub-agent's.
    expect(before.map((line) => line.agent)).toEqual([undefined, mira, undefined]);
    expect(stepsOf(before).map((line) => line.agent)).toEqual([undefined, undefined, undefined]);
    const pictured = linesOf(session, { agent: { ...mira } });
    expect(same(before, pictured)).toEqual([true, false, true]);
    // Whose an event is, is a fact of the event: another fact is another event, and its line
    // is drawn again, and that line alone of the sub-agent's.
    const renamed = linesOf(
      session.map((one) =>
        one.n === 3
          ? event(3, { kind: "assistant", text: "Looking.", data: { ...whose, subagent: "Plan" } })
          : one,
      ),
    );
    expect(same(stepsOf(before), stepsOf(renamed))).toEqual([true, false, true]);
    // A text read whole inside the row is that line's, and the row's with it.
    const whole = { of: "session", texts: { 3: "Looking, at length." } };
    const read = linesOf(session, { whole });
    expect(same(stepsOf(before), stepsOf(read))).toEqual([true, false, true]);
    expect(same(before, read)).toEqual([false, true, true]);
  });

  it("shows what the agent said as Markdown that is never HTML, with no picture fetched", () => {
    const said = [
      "## What I found",
      "",
      "- The **form** has one step.",
      "- See [the task](https://console.acme.example/projects/web/tasks/412) and `messages.ts`.",
      "",
      "| File | Lines |",
      "|---|---|",
      "| form.tsx | 120 |",
      "",
      "```ts",
      "const one = 1;",
      "```",
      "",
      "![the page](https://img.example/page.png) ![](https://img.example/bare.png) ![inline](data:image/png;base64,AAAA)",
      "",
      '<img src="https://img.example/raw.png" onerror="alert(1)"> [x](javascript:alert(1))',
    ].join("\n");
    const seen = renderToStaticMarkup(
      <TranscriptView
        agent={mira}
        events={[
          event(1, { kind: "person", text: "**Not** Markdown.", data: { signal: 1 } }),
          event(2, { text: said, whole: 90_000 }),
          event(3, { kind: "thinking", text: "A *thought* stays text." }),
          event(4, { kind: "tool_call", text: "# not a heading", data: { tool: "Bash", id: "t" } }),
          event(5, { kind: "tool_result", text: "**out**", data: { id: "t", error: false } }),
        ]}
        fileHref={(id) => id}
        onReadWhole={async () => "whole"}
      />,
    );
    // What the agent said: headings, a list, a table and code, as elements.
    expect(seen).toContain(
      '<li class="sc-talk-item sc-talk-said" data-n="2"><span class="sc-avatar',
    );
    expect(seen).toContain(
      '<div class="sc-talk-prose"><div class="sc-prose"><h2>What I found</h2>',
    );
    expect(seen).toContain("<li>The <strong>form</strong> has one step.</li>");
    expect(seen).toContain("<th>File</th>");
    expect(seen).toContain('<pre><code class="language-ts">const one = 1;\n</code></pre>');
    // A link opens elsewhere, and says nothing of where it came from.
    expect(seen).toContain(
      '<a href="https://console.acme.example/projects/web/tasks/412" target="_blank" rel="noopener noreferrer nofollow ugc">the task</a>',
    );
    // A picture is not fetched: its words, as a link for whoever chooses to open it; one that
    // is no address on the web is its words alone.
    expect(seen).not.toContain("<img");
    expect(seen).toContain(
      '<a href="https://img.example/page.png" target="_blank" rel="noopener noreferrer nofollow ugc">the page</a>',
    );
    expect(seen).toContain(
      '<a href="https://img.example/bare.png" target="_blank" rel="noopener noreferrer nofollow ugc">https://img.example/bare.png</a>',
    );
    expect(seen).toContain('<span class="sc-prose-image-text">inline</span>');
    expect(seen).not.toContain("/api/v1/pictures");
    // Raw HTML stays text, and a link that would run something leads nowhere.
    expect(seen).toContain("&lt;img src=");
    expect(seen).not.toContain('onerror="alert');
    expect(seen).not.toContain('href="javascript:');
    expect(seen).toContain("<span>x</span>");
    // A text the row keeps the beginning of is rendered as far as it goes, with the way to the rest.
    expect(seen).toContain("The beginning of 88 KB.");
    expect(seen).toContain(">Read it whole<");
    // What it was told, a thought, a tool's call and its answer stay text as they were written.
    expect(seen).toContain('<pre class="sc-talk-text">**Not** Markdown.</pre>');
    expect(seen).toContain('<pre class="sc-talk-text">A *thought* stays text.</pre>');
    expect(seen).toContain('<pre class="sc-talk-code"># not a heading</pre>');
    expect(seen).toContain('<pre class="sc-talk-code sc-talk-code-answer">**out**</pre>');
  });

  it("reads off a session's events whether a turn is under way, and what the agent is at", () => {
    const told = event(1, { kind: "person", text: "Go.", data: { signal: 4 } });
    const done = event(9, {
      kind: "status",
      text: "The turn completed.",
      data: { turn: "completed" },
    });
    expect(workingOf([])).toBeUndefined();
    // Told and nothing said yet, or a thought: thinking.
    expect(workingOf([told])).toEqual({ at: "thinking" });
    expect(workingOf([told, event(2, { kind: "thinking", text: "Hm." })])).toEqual({
      at: "thinking",
    });
    // A call that was not answered is the tool it runs; answered, the agent is at work again.
    const call = event(3, { kind: "tool_call", text: "ls", data: { tool: "Bash", id: "t1" } });
    expect(workingOf([told, call])).toEqual({ at: "tool", tool: "Bash" });
    expect(
      workingOf([told, call, event(4, { kind: "tool_result", text: "a", data: { id: "t1" } })]),
    ).toEqual({ at: "working" });
    expect(workingOf([told, event(2, { text: "Looking." })])).toEqual({ at: "working" });
    // A status that is no end of a turn, and a permission, say nothing of it.
    expect(
      workingOf([told, call, event(4, { kind: "status", text: "Compacted.", data: {} })]),
    ).toEqual({ at: "tool", tool: "Bash" });
    // Where the record says the turn ended, or the session did, no turn is under way.
    expect(workingOf([told, event(2, { text: "Done." }), done])).toBeUndefined();
    expect(
      workingOf([
        told,
        event(2, {
          kind: "status",
          text: "The session ended: stopped.",
          data: { ended: "stopped" },
        }),
      ]),
    ).toBeUndefined();
    expect(
      workingOf([told, done, event(10, { kind: "wake", text: "", data: { signal: 5 } })]),
    ).toEqual({ at: "thinking" });
    // The last signal the record says was taken; nothing where no event carries one.
    expect(takenOf([told, call, event(10, { kind: "wake", text: "", data: { signal: 6 } })])).toBe(
      6,
    );
    expect(takenOf([call])).toBeUndefined();
  });

  it("knows which of the words sent still wait: a supervisor's, after the last signal the agent took", () => {
    const signal = (number: number, over: Partial<RestSignal> = {}): RestSignal => ({
      number,
      kind: "tell",
      by: alice,
      agent: null,
      plugin: null,
      source: "person",
      key: null,
      text: `Word ${number}.`,
      set: null,
      attachments: [],
      at: WHEN,
      ...over,
    });
    const SHEET = {
      id: "0199c4d8-0000-7000-8000-0000000000f2",
      name: "a.csv",
      size: 3,
      contentType: "text/csv",
    };
    const record = [
      signal(7, { kind: "interrupt", text: "" }),
      signal(6),
      signal(5, { kind: "wake", source: "board", by: null, text: "A task." }),
      signal(4, { kind: "interrupt", text: "Stop that." }),
      signal(3),
      signal(2, { kind: "stop", text: "Enough." }),
    ];
    // The oldest first; a wake, a stop and an interrupt with no words are no message that waits.
    expect(waitingOf(record, 2).map((one) => one.number)).toEqual([3, 4, 6]);
    expect(waitingOf(record, 4).map((one) => one.number)).toEqual([6]);
    expect(waitingOf(record, 7)).toEqual([]);
    // Files alone wait too, as what was sent.
    expect(waitingOf([signal(8, { text: "", attachments: [SHEET] })], 0)).toHaveLength(1);
    // So do the words of a reset, a supervisor's or the account's own (ADR-0154), which a new
    // conversation begins with; a reset with none, and a restart, are no message that waits.
    const own = { ...alice, id: "0199c4d8-0000-7000-8000-0000000000a9", name: "Mira" };
    const anew = signal(11, { kind: "reset", by: own, text: "The release is out." });
    expect(
      waitingOf(
        [
          anew,
          signal(10, { kind: "reset", text: "Start over." }),
          signal(9, { kind: "reset", text: "" }),
          signal(8, { kind: "restart", text: "Go on." }),
        ],
        7,
      ).map((one) => one.number),
    ).toEqual([10, 11]);
    // The account's own reset waits for its turn to end, whatever was taken after it: a tell
    // sent later and taken in the same turn moves the count of what was taken past it, and
    // the reset waits still. It is told by the session it was sent in, which taking it ends.
    const began = "2026-10-10T10:00:00.000Z";
    const before = signal(9, {
      kind: "reset",
      by: own,
      text: "Yesterday's.",
      at: "2026-10-09T18:00:00.000Z",
    });
    const during = signal(12, {
      kind: "reset",
      by: own,
      text: "The release is out.",
      at: "2026-10-10T10:20:00.000Z",
    });
    const later = signal(13, { text: "Tag it before you go.", at: "2026-10-10T10:21:00.000Z" });
    const all = [later, during, before];
    expect(isOwnReset(during, own.id)).toBe(true);
    expect(isOwnReset(signal(14, { kind: "reset", text: "A supervisor's." }), own.id)).toBe(false);
    expect(isOwnReset(signal(15, { by: own }), own.id)).toBe(false);
    // The tell was taken: nothing of it waits, and the count is past the reset.
    expect(
      waitingOf(
        all.filter((one) => !isOwnReset(one, own.id)),
        13,
      ),
    ).toEqual([]);
    expect(ownResetWaiting(all, own.id, began)?.number).toBe(12);
    // One of a session before waits no more, and none waits where no session is open.
    expect(ownResetWaiting([before], own.id, began)).toBeUndefined();
    expect(ownResetWaiting(all, own.id, undefined)).toBeUndefined();
    // A second stands for the first, which is let go.
    const second = signal(16, {
      kind: "reset",
      by: own,
      text: "On second thought.",
      at: "2026-10-10T10:30:00.000Z",
    });
    expect(ownResetWaiting([...all, second], own.id, began)?.number).toBe(16);
    // Another account's is no reset of this one.
    expect(ownResetWaiting(all, alice.id, began)).toBeUndefined();
    // A pane is followed while whoever reads is at its end, give or take a line.
    expect(followsEnd({ scrollHeight: 2000, scrollTop: 1400, clientHeight: 600 })).toBe(true);
    expect(
      followsEnd({ scrollHeight: 2000, scrollTop: 1400 - FOLLOW_SLACK, clientHeight: 600 }),
    ).toBe(true);
    expect(
      followsEnd({ scrollHeight: 2000, scrollTop: 1399 - FOLLOW_SLACK, clientHeight: 600 }),
    ).toBe(false);
    // Once it scrolled: at its end it follows, whoever moved it and whatever it did before.
    const far = { scrollHeight: 2000, scrollTop: 900, clientHeight: 600 };
    expect(followsAfter(false, true, { ...far, scrollTop: 1400 })).toBe(true);
    expect(followsAfter(false, false, { ...far, scrollTop: 1400 })).toBe(true);
    // Away from its end by the reader's hand, it follows no more.
    expect(followsAfter(true, true, far)).toBe(false);
    // Away from its end by itself, it goes on as it was: a conversation read again is short for
    // a moment, and the pane stands at its top by the time it is told; and what arrives makes
    // the conversation taller under a pane that has not moved.
    expect(followsAfter(true, false, { scrollHeight: 3057, scrollTop: 0, clientHeight: 402 })).toBe(
      true,
    );
    expect(followsAfter(true, false, { ...far, scrollHeight: 2600 })).toBe(true);
    expect(followsAfter(false, false, far)).toBe(false);

    // At the conversation's foot: each as it will stand, with when it is read under the last,
    // and the way to have it read now while a turn is under way.
    const waiting = renderToStaticMarkup(
      <ol>
        <TalkWaiting
          signals={[signal(3), signal(6, { attachments: [SHEET] })]}
          why="turn"
          onInterrupt={() => undefined}
        />
      </ol>,
    );
    expect(waiting.match(/<li class="sc-talk-item sc-talk-told sc-talk-waiting"/g)).toHaveLength(2);
    expect(waiting).toContain('<pre class="sc-talk-text">Word 3.</pre>');
    expect(waiting).toContain("a.csv");
    expect(waiting.match(/Delivered when the turn under way ends\./g)).toHaveLength(1);
    expect(waiting).toMatch(
      /<button[^>]*title="Stops the turn under way so that this is read now\."[^>]*>Interrupt<\/button>/,
    );
    // With no turn to stop there is no such way: it says when the words are read, and that is all.
    for (const [why, says] of [
      ["stopped", "Delivered once it is started again."],
      ["unheard", "Delivered once its runner is heard from."],
      ["soon", "On its way to the agent."],
    ] as const) {
      const still = renderToStaticMarkup(
        <ol>
          <TalkWaiting signals={[signal(3)]} why={why} onInterrupt={() => undefined} />
        </ol>,
      );
      expect(still).toContain(says);
      expect(still).not.toContain(">Interrupt<");
    }
    expect(
      renderToStaticMarkup(
        <ol>
          <TalkWaiting signals={[signal(3)]} why="call" />
        </ol>,
      ),
    ).not.toContain(">Interrupt<");
    expect(renderToStaticMarkup(<TalkWaiting signals={[]} why="call" />)).toBe("");
    // The account's own reset waits for the turn under way to end: it stands as what a
    // supervisor said does, named as a reset beside who sent it, with when the new
    // conversation begins and the way to have it begin now.
    const begins = renderToStaticMarkup(
      <ol>
        <TalkWaiting signals={[signal(3), anew]} why="turn" onInterrupt={() => undefined} />
      </ol>,
    );
    expect(begins).toContain('<pre class="sc-talk-text">The release is out.</pre>');
    expect(begins).toMatch(
      /<span class="sc-name">Mira<\/span><span class="sc-badge sc-badge-neutral">New conversation<\/span>/,
    );
    // A tell is named as nothing more than who said it.
    expect(begins.match(/class="sc-badge/g)).toHaveLength(1);
    expect(begins.match(/Delivered when the turn under way ends\./g)).toHaveLength(1);
    expect(begins).not.toContain("Delivered after the tool call under way.");
    expect(begins).toContain(">Interrupt<");
    const korean = renderToStaticMarkup(
      <LanguageContext.Provider value={KOREAN}>
        <ol>
          <TalkWaiting signals={[signal(3)]} why="call" onInterrupt={() => undefined} />
        </ol>
      </LanguageContext.Provider>,
    );
    expect(korean).toContain(KOREAN.messages.agents.page.live.waiting.call);
    expect(korean).toContain(">끼어들기<");
    const koreanAnew = renderToStaticMarkup(
      <LanguageContext.Provider value={KOREAN}>
        <ol>
          <TalkWaiting signals={[anew]} why="turn" />
        </ol>
      </LanguageContext.Provider>,
    );
    expect(koreanAnew).toContain("지금 턴이 끝나면 전달됩니다.");
    expect(koreanAnew).toContain(">새 대화<");
  });

  it("shows that the agent is at work, and the conversation in a pane with the box at its foot", () => {
    expect(renderToStaticMarkup(<TalkWorking working={undefined} />)).toBe("");
    const thinking = renderToStaticMarkup(
      <ol>
        <TalkWorking working={{ at: "thinking" }} agent={mira} />
      </ol>,
    );
    expect(thinking).toContain('<li class="sc-talk-item sc-talk-working sc-note" role="status">');
    expect(thinking).toContain('<span class="sc-talk-dots" aria-hidden="true">');
    expect(thinking).toContain(">Thinking<");
    expect(
      renderToStaticMarkup(
        <ol>
          <TalkWorking working={{ at: "tool", tool: "Bash" }} />
        </ol>,
      ),
    ).toContain(">Running Bash<");
    expect(
      renderToStaticMarkup(
        <ol>
          <TalkWorking working={{ at: "tool", tool: undefined }} />
        </ol>,
      ),
    ).toContain(">Working<");
    // Where sub-agents run, the row says how many, and names each under it with what it is at
    // and how many tools it called; how long it has run is counted by the page.
    const at = (name: string, n: number, over: object = {}) => ({
      n,
      name,
      startedAt: new Date(Date.now() - 65_000).toISOString(),
      state: "running" as const,
      seconds: 65,
      calls: 4,
      at: { at: "tool" as const, tool: "Bash" },
      ...over,
    });
    const agents = renderToStaticMarkup(
      <ol>
        <TalkWorking
          working={{ at: "tool", tool: "Agent" }}
          agent={mira}
          agents={[
            at("Explore: Find the routes", 3),
            at("", 4, { calls: 1, at: { at: "thinking" } }),
            at("<b>Plan</b>", 5, { calls: 0, at: undefined }),
          ]}
        />
      </ol>,
    );
    expect(agents).toContain(
      '<li class="sc-talk-item sc-talk-working sc-note sc-talk-working-agents" role="status">',
    );
    expect(agents).toContain("<span>3 sub-agents at work</span>");
    expect(agents).not.toContain("Running Agent");
    expect(agents).toContain('<ul class="sc-talk-agents" aria-live="off">');
    expect(agents).toMatch(
      /<li class="sc-talk-agents-row"><span class="sc-name sc-talk-agent-name">Explore: Find the routes<\/span><span class="sc-talk-agents-facts">Running Bash · 4 tool calls · 1:0\d<\/span><\/li>/,
    );
    // One the record gives no name is called what it is; a name is text.
    expect(agents).toMatch(/sc-talk-agent-name">Sub-agent<\/span>[^/]*>Thinking · 1 tool call · /);
    expect(agents).toContain("&lt;b&gt;Plan&lt;/b&gt;");
    expect(agents).toMatch(/>Working · 0 tool calls · /);
    expect(
      renderToStaticMarkup(
        <ol>
          <TalkWorking working={{ at: "tool", tool: "Agent" }} agents={[at("One", 1)]} />
        </ol>,
      ),
    ).toContain("<span>1 sub-agent at work</span>");
    // With none at work the row is as it was; and with no turn under way and none there is no row.
    expect(
      renderToStaticMarkup(
        <ol>
          <TalkWorking working={{ at: "thinking" }} agents={[]} />
        </ol>,
      ),
    ).toContain('<li class="sc-talk-item sc-talk-working sc-note" role="status">');
    expect(renderToStaticMarkup(<TalkWorking working={undefined} agents={[]} />)).toBe("");
    // Sub-agents that go on in the background are at work past the turn that started them:
    // the row stands for them alone.
    const past = renderToStaticMarkup(
      <ol>
        <TalkWorking working={undefined} agent={mira} agents={[at("One", 1)]} />
      </ol>,
    );
    expect(past).toContain(
      '<li class="sc-talk-item sc-talk-working sc-note sc-talk-working-agents" role="status">',
    );
    expect(past).toContain("<span>1 sub-agent at work</span>");
    expect(past).toMatch(/sc-talk-agent-name">One<\/span>[^/]*>Running Bash · 4 tool calls · /);
    const koreanAgents = renderToStaticMarkup(
      <LanguageContext.Provider value={KOREAN}>
        <ol>
          <TalkWorking working={{ at: "working" }} agents={[at("One", 1), at("Two", 2)]} />
        </ol>
      </LanguageContext.Provider>,
    );
    expect(koreanAgents).toContain("<span>서브 에이전트 2개 작업 중</span>");
    expect(koreanAgents).toMatch(/>Bash 실행 중 · 도구 호출 4회 · /);
    const pane = renderToStaticMarkup(
      <ChatPane label="What the agent is doing" composer={<form>box</form>}>
        <p>conversation</p>
      </ChatPane>,
    );
    expect(pane).toBe(
      '<section class="sc-panel sc-chat" aria-label="What the agent is doing"><div class="sc-chat-scroll"><div class="sc-chat-content"><p>conversation</p></div></div><div class="sc-chat-foot"><form>box</form></div></section>',
    );
    // Read at its end, there is no way back to the latest to offer.
    expect(pane).not.toContain("sc-chat-latest");
  });

  it("adds the files chosen to the ones of a tell, each once", () => {
    const file = (name: string, size: number) =>
      new File([new Uint8Array(size)], name, { type: "image/png", lastModified: 1 });
    const first = file("one.png", 3);
    const second = file("two.png", 4);
    // Chosen again, what is there stays: one more choice adds to it.
    expect(withChosen([first], [second]).map((one) => one.name)).toEqual(["one.png", "two.png"]);
    // A file that is there already, or chosen twice at once, is sent once.
    expect(withChosen([first, second], [file("one.png", 3)])).toEqual([first, second]);
    expect(withChosen([], [first, file("one.png", 3)])).toEqual([first]);
    // The same name with other bytes is another file.
    expect(withChosen([first], [file("one.png", 9)])).toHaveLength(2);
    // The way out of a chip takes that file out and leaves the others in their order.
    const third = file("three.png", 5);
    expect(withoutChosen([first, second, third], 1)).toEqual([first, third]);
    expect(withoutChosen([first], 0)).toEqual([]);
    expect(withoutChosen([first, second], 5)).toEqual([first, second]);
    // A picture pasted from a clipboard is called the same by every browser: named by the moment.
    const at = new Date(2026, 10, 12, 9, 5, 7);
    expect(pastedName(file("image.png", 1), at)).toBe("pasted-20261112-090507.png");
    expect(pastedName(new File([new Uint8Array(1)], "image.png", { type: "image/jpeg" }), at)).toBe(
      "pasted-20261112-090507.jpg",
    );
    expect(pastedName(file("chart.png", 1), at)).toBe("chart.png");
  });

  it("tells with Enter, as the box of an agent product does, and never while a word is being composed", () => {
    const key = (over: object) => ({ key: "Enter", shiftKey: false, isComposing: false, ...over });
    expect(tellsWith(key({}))).toBe(true);
    // Shift with Enter is a new line, and another key is whatever it is.
    expect(tellsWith(key({ shiftKey: true }))).toBe(false);
    expect(tellsWith(key({ key: "a" }))).toBe(false);
    // Enter that ends the composing of a word, as in Korean, ends the word and not the message;
    // a browser that says nothing of composing says it by the key's number.
    expect(tellsWith(key({ isComposing: true }))).toBe(false);
    expect(tellsWith(key({ keyCode: 229 }))).toBe(false);
    expect(tellsWith({ key: "Enter" })).toBe(true);
  });

  it("keeps a text read whole to the session it was read in", () => {
    const first = "0199c4d8-0000-7000-8000-0000000000a1";
    const second = "0199c4d8-0000-7000-8000-0000000000a2";
    // Every session numbers its events from one: event 12 of the session after a restart is
    // another event than event 12 of the one before, and never shows that one's text.
    const read = withWhole(NO_WHOLE, first, 12, "The whole result of session one.");
    expect(wholeOf(read, first, 12)).toBe("The whole result of session one.");
    expect(wholeOf(read, second, 12)).toBeUndefined();
    expect(wholeOf(read, undefined, 12)).toBeUndefined();
    expect(wholeOf(read, first, 13)).toBeUndefined();
    // What is read in one session stands beside the others read in it, and lets go of another's.
    const more = withWhole(read, first, 13, "Another.");
    expect(wholeOf(more, first, 12)).toBe("The whole result of session one.");
    expect(wholeOf(more, first, 13)).toBe("Another.");
    const next = withWhole(more, second, 12, "The whole result of session two.");
    expect(wholeOf(next, second, 12)).toBe("The whole result of session two.");
    expect(wholeOf(next, first, 12)).toBeUndefined();
    expect(wholeOf(next, second, 13)).toBeUndefined();
    // A view that is told of no session keeps what it read, as one view of one list of events.
    expect(wholeOf(withWhole(NO_WHOLE, undefined, 3, "Whole."), undefined, 3)).toBe("Whole.");
  });

  it("puts the events before a session's first shown one in once, however often they are read", () => {
    const shown = [event(201), event(202)];
    const earlier = [event(199), event(200), event(201)];
    const once = withEarlier(shown, earlier, 200);
    expect(once.map((one) => one.n)).toEqual([199, 200, 201, 202]);
    // The same page read again, as two presses at once read it, adds nothing.
    expect(withEarlier(once, earlier, 200).map((one) => one.n)).toEqual([199, 200, 201, 202]);
    expect(withEarlier(once, earlier, 198).map((one) => one.n)).toEqual([199, 200, 201, 202]);
  });

  it("empties the box to speak in only once what was told was taken", async () => {
    // Whoever tells says whether the console took it: a refusal, or a request that failed, keeps
    // the words and the files where they are, to be sent again.
    expect(await takenBy(Promise.resolve(false))).toBe(false);
    expect(await takenBy(Promise.reject(new Error("the request failed")))).toBe(false);
    expect(await takenBy(false)).toBe(false);
    expect(await takenBy(Promise.resolve(true))).toBe(true);
    // A console of one's own whose handler answers nothing is taken at its word, as before.
    expect(await takenBy(undefined)).toBe(true);
    expect(await takenBy(Promise.resolve(undefined))).toBe(true);
    // Once taken, the box holds nothing of what was sent, and keeps what was written meanwhile.
    expect(afterTold("Look at the ledger.", "Look at the ledger.")).toBe("");
    expect(afterTold("Look at the ledger.\nAnd the rota.", "Look at the ledger.")).toBe(
      "And the rota.",
    );
    expect(afterTold("Something else by now.", "Look at the ledger.")).toBe(
      "Something else by now.",
    );
  });

  it("offers what a supervisor says to it: words and files in one box, a tell, and nothing that stops a turn or changes how it stands", () => {
    const running = renderToStaticMarkup(
      <SignalComposer state="running" onSend={() => undefined} />,
    );
    expect(running).toContain(">Tell<");
    // The way to have what was told read now stands beside it in the conversation, not here.
    expect(running).not.toContain(">Interrupt<");
    expect(running).toContain('<div class="sc-signal-box">');
    // What changes how the agent stands is said apart from what is said to it.
    expect(running).not.toContain(">Stop<");
    expect(running).not.toContain(">New conversation<");
    // Nothing is said yet: there is nothing to tell.
    expect(/<button[^>]*type="submit"[^>]*>/.exec(running)?.[0]).toContain('disabled=""');
    // Files of any kind, chosen with the console's file picker, as a decision's files are.
    expect(running).not.toContain("accept=");
    expect(running).toContain('class="sc-button sc-button-ghost sc-button-sm sc-file-choice"');
    expect(running).toContain('class="sc-file-input"');
    expect(running).toContain(">Attach files<");
    // How the keys work is not said: the box works as the box of a chat does.
    expect(running).not.toContain("Enter tells");
    expect(running).not.toContain("sc-field-hint");
    const stopped = renderToStaticMarkup(
      <SignalComposer state="stopped" note="It could not be sent." onSend={() => undefined} />,
    );
    expect(stopped).toContain(
      'placeholder="It is stopped: what you say is read once it is started again"',
    );
    expect(stopped).toContain("It could not be sent.");
  });

  it("offers what changes how an agent stands, apart from what is said to it, with what each does", () => {
    const of = (state: "running" | "stopped" | "refused" | undefined) =>
      renderToStaticMarkup(<AgentControls state={state} onSend={() => undefined} />);
    const running = of("running");
    expect(running).toContain(">Stop</button>");
    expect(running).not.toContain(">Restart</button>");
    expect(running).toContain(">New conversation</button>");
    expect(running).toContain("<b>Stop</b> Ends its session.");
    expect(running).toContain(
      "<b>New conversation</b> Ends this conversation and begins a new one.",
    );
    expect(running).toContain(">Words for the agent<");
    // A stopped agent is started again; one that could not go on is either.
    const stopped = of("stopped");
    expect(stopped).toContain(">Restart</button>");
    expect(stopped).not.toContain(">Stop</button>");
    expect(stopped).toContain("<b>Restart</b> Goes on with the same conversation.");
    const refused = of("refused");
    expect(refused).toContain(">Restart</button>");
    expect(refused).toContain(">Stop</button>");
    // What was sent last is said under the ways, where it was sent from.
    expect(
      renderToStaticMarkup(
        <AgentControls state="running" note="Sent as #4: stop." onSend={() => undefined} />,
      ),
    ).toContain('<p class="sc-field-hint" role="status">Sent as #4: stop.</p>');
  });

  it("offers the model and the effort its product offers, and says what the open session runs with", () => {
    expect(renderToStaticMarkup(<AgentChoice runner={null} onSet={() => undefined} />)).toContain(
      "offered nothing to choose from yet",
    );
    const seen = renderToStaticMarkup(<AgentChoice runner={runner} onSet={() => undefined} />);
    expect(seen).toContain('<option value="">the product&#x27;s own</option>');
    expect(seen).toContain('<option value="sonnet" selected="">sonnet</option>');
    expect(seen).toContain('<option value="high">high</option>');
    expect(seen).toContain("The open session runs with model opus, effort the product&#x27;s own.");
    // What is chosen stays choosable when the product offers it no more.
    const gone = renderToStaticMarkup(
      <AgentChoice
        runner={{ ...runner, settings: { model: "an-older-model", effort: null } }}
        onSet={() => undefined}
      />,
    );
    expect(gone).toContain('<option value="an-older-model" selected="">an-older-model</option>');
  });

  it("lists its sessions with how each ended and what it holds, and what its runner said of itself", () => {
    const seen = renderToStaticMarkup(
      <AgentSessionList
        sessions={[
          session(),
          session({
            id: "0199c4d8-0000-7000-8000-0000000000a2",
            ended: "taken_over",
            endedAt: WHEN,
            events: 1,
            resumed: true,
            away: true,
          }),
        ]}
        href={(one) => `/agents/mira/sessions/${one.id}`}
      />,
    );
    expect(seen).toContain('href="/agents/mira/sessions/0199c4d8-0000-7000-8000-0000000000a1"');
    expect(seen).toContain(">open<");
    expect(seen).toContain(">taken over<");
    expect(seen).toContain(">put away<");
    expect(seen).toContain("Claude Code 2.1.0 · opus · mac-mini");
    expect(seen).toContain('<span class="sc-agent-session-count">12 events</span>');
    expect(seen).toContain("Claude Code 2.1.0 · opus · goes on with the conversation before");
    expect(seen).toContain('<span class="sc-agent-session-count">1 event</span>');
    // A session that ended says until when; the open one says so in a badge of a state.
    expect(seen).toContain('class="sc-agent-session-until"');
    expect(seen).toContain(
      '<span class="sc-badge sc-badge-success sc-badge-kind-state">open</span>',
    );
    const facts = renderToStaticMarkup(<AgentRunnerFacts runner={runner} />);
    expect(facts).toContain("<dt>Machine</dt><dd>mac-mini · Darwin 24.1.0</dd>");
    expect(facts).toContain("<dt>OS account</dt><dd>mira</dd>");
    expect(facts).toContain("a version the driver was not tried with");
    expect(facts).toContain("8 of 10 delivered");
    expect(renderToStaticMarkup(<AgentRunnerFacts runner={null} />)).toContain(
      "No runner has been heard from.",
    );
  });

  it("lists the accounts it holds elsewhere, as words (ADR-0089)", () => {
    const seen = renderToStaticMarkup(
      <AgentElsewhereList accounts={{ github: "acme-mira", slack: "<b>U0123</b>" }} />,
    );
    expect(seen).toContain("<dt>github</dt><dd>acme-mira</dd>");
    expect(seen).toContain("<dt>slack</dt><dd>&lt;b&gt;U0123&lt;/b&gt;</dd>");
    expect(seen).toContain("What to close when the account is taken out.");
    for (const none of [{}, undefined]) {
      expect(renderToStaticMarkup(<AgentElsewhereList accounts={none} />)).toContain(
        "None is recorded yet.",
      );
    }
  });

  it("lists its secrets by name, with the way to seed one, and never a value", () => {
    const seen = renderToStaticMarkup(
      <AgentSecretList
        secrets={[
          { name: "git.token", setAt: WHEN, seeded: false, expiresOn: "2027-11-10" },
          { name: "mail.password", setAt: WHEN, seeded: true, expiresOn: null },
        ]}
        onSeed={() => undefined}
        onRemove={() => undefined}
      />,
    );
    expect(seen).toContain("<code>git.token</code>");
    expect(seen).toContain("ends on 2027-11-10");
    expect(seen).toContain("seeded by a supervisor");
    expect(seen).toContain('type="password"');
    expect(seen).toContain("only the account reads it back");
    expect(seen.match(/>Remove</g)).toHaveLength(2);
  });

  it("lists the secrets offered to an account by name, with who offers each and how it stands (ADR-0169)", () => {
    const offer = {
      id: "0199c4d8-0000-7000-8000-0000000000a1",
      name: "mail.password",
      note: "for the support mailbox",
      by: alice,
      agent: null,
      expiresOn: null,
      state: "waiting",
      at: WHEN,
      endsAt: "2026-10-16T10:00:00.000Z",
      decidedAt: null,
      takenAs: null,
    } as const;
    const offers = (
      <AgentSecretOfferList
        offers={[
          offer,
          {
            ...offer,
            id: "0199c4d8-0000-7000-8000-0000000000a2",
            name: "git.token",
            by: null,
            state: "taken",
            takenAs: "git.spare",
          },
          { ...offer, id: "0199c4d8-0000-7000-8000-0000000000a3", name: "old", state: "lapsed" },
          { ...offer, id: "0199c4d8-0000-7000-8000-0000000000a4", name: "no", state: "left" },
        ]}
      />
    );
    const seen = renderToStaticMarkup(offers);
    expect(seen).toContain(
      '<ul class="sc-divided sc-agent-secret-list" aria-label="Offered secrets">',
    );
    expect(seen).toContain("<code>mail.password</code>");
    expect(seen).toContain("Alice Example");
    expect(seen).toContain("Someone who is gone");
    expect(seen).toContain("as git.spare");
    for (const state of ["Waiting", "Taken", "Ran out", "Left"]) {
      expect(seen).toContain(`>${state}</span>`);
    }
    // A row says the name, who and when: what the offerer wrote of it is not drawn here.
    expect(seen).not.toContain("support mailbox");
    const korean = renderToStaticMarkup(
      <LanguageContext.Provider value={KOREAN}>{offers}</LanguageContext.Provider>,
    );
    for (const state of ["대기 중", "받음", "기한 지남", "받지 않음"]) {
      expect(korean).toContain(`>${state}</span>`);
    }
    expect(korean).toContain("받은 이름: git.spare");
  });

  it("offers an account a secret from a form whose value is typed unseen (ADR-0169)", () => {
    const form = <AgentSecretOfferForm account="Mira" onOffer={() => undefined} />;
    const seen = renderToStaticMarkup(form);
    expect(seen).toContain('<form class="sc-form" aria-label="Offer a secret">');
    expect(seen).toContain('type="password"');
    expect(seen).toContain('autoComplete="new-password"');
    expect(seen).toContain(">What it is for</span>");
    expect(seen).toContain('maxLength="200"');
    expect(seen).toContain(
      "Mira is told, and takes it or leaves it. The value is typed here once and shown to nobody; an offer not taken is gone after 7 days.",
    );
    // With no name and no value, there is nothing to offer yet.
    expect(seen).toContain(
      '<button disabled="" type="submit" class="sc-button sc-button-primary">Offer</button>',
    );
    expect(
      renderToStaticMarkup(
        <LanguageContext.Provider value={KOREAN}>{form}</LanguageContext.Provider>,
      ),
    ).toContain("받지 않은 제안은 7일 뒤 사라집니다.");
  });

  it("shows the invitation under the account: the one line once, and never the code again (ADR-0088)", () => {
    const invitation = { createdAt: WHEN, expiresAt: "2026-11-17T14:02:11.000Z", by: alice };
    const command = "console agent setup --console https://console.test --code ABCD-EFGH";
    const nothing = () => undefined;
    const href = (code: string) => `/setup/${code}`;
    // None stands: what an invitation is, and the way to make one.
    const none = renderToStaticMarkup(
      <AgentInvitationPanel
        invitation={null}
        guideHref={href}
        onInvite={nothing}
        onRevoke={nothing}
      />,
    );
    expect(none).toContain("No invitation stands.");
    expect(none).toContain("Its code is no credential");
    expect(none).toContain(">Make an invitation</button>");
    expect(none).not.toContain("Take it away");
    // Under the steps of an account that is getting started, the step says what it is.
    expect(
      renderToStaticMarkup(
        <AgentInvitationPanel
          invitation={null}
          intro={false}
          guideHref={href}
          onInvite={nothing}
          onRevoke={nothing}
        />,
      ),
    ).not.toContain("Its code is no credential");
    // Just made: the sentence and the command to copy, the guide's address, and its day.
    const made = renderToStaticMarkup(
      <AgentInvitationPanel
        invitation={invitation}
        made={{ invitation, code: "ABCD-EFGH", command }}
        guideHref={href}
        onInvite={nothing}
        onRevoke={nothing}
      />,
    );
    // The line has whoever is given it install what is missing and ask for a sign-in alone
    // (ADR-0140).
    expect(made).toContain(
      `<pre class="sc-code">Set this machine up for an agent account. Install what is missing yourself, without asking: first Node.js 24 or later and the command (npm i -g @skillcdn/console). Then run ${command} and do what it prints. Ask me only for a sign-in or an administrator&#x27;s password.</pre>`,
    );
    expect(made).toContain(`<pre class="sc-code">${command}</pre>`);
    // The sentence is said by whoever reads the page, so it is in their language: the command
    // and the install as written, the words between them from the pack.
    const madeInKorean = renderToStaticMarkup(
      <LanguageContext.Provider value={KOREAN}>
        <AgentInvitationPanel
          invitation={invitation}
          made={{ invitation, code: "ABCD-EFGH", command }}
          guideHref={href}
          onInvite={nothing}
          onRevoke={nothing}
        />
      </LanguageContext.Provider>,
    );
    expect(madeInKorean).toContain(
      `<pre class="sc-code">이 머신을 에이전트 계정용으로 설정하세요. 없는 것은 묻지 말고 직접 설치하세요: 먼저 Node.js 24 이상과 명령(npm i -g @skillcdn/console). 그다음 ${command} 를 실행하고 출력되는 대로 진행하세요. 로그인이나 관리자 비밀번호가 필요할 때만 저에게 물어보세요.</pre>`,
    );
    expect(madeInKorean).toContain(`<pre class="sc-code">${command}</pre>`);
    expect(madeInKorean).not.toContain("Install what is missing yourself");
    expect(made).toContain('href="/setup/ABCD-EFGH"');
    expect(made).toContain("The code is shown this once.");
    expect(made).toContain(">Make it again</button>");
    expect(made).toContain(">Take it away</button>");
    // Standing, read again: who made it and until when, and no code anywhere.
    const standsThere = renderToStaticMarkup(
      <AgentInvitationPanel
        invitation={invitation}
        guideHref={href}
        onInvite={nothing}
        onRevoke={nothing}
      />,
    );
    expect(standsThere).toContain("An invitation stands until");
    expect(standsThere).toContain("made by Alice Example");
    expect(standsThere).not.toContain("ABCD");
    expect(standsThere).not.toContain("console agent setup");
    // Not read yet: nothing is said of it, and nothing is made over it.
    const unread = renderToStaticMarkup(
      <AgentInvitationPanel
        invitation={undefined}
        guideHref={href}
        onInvite={nothing}
        onRevoke={nothing}
      />,
    );
    expect(unread).not.toContain("No invitation stands.");
    expect(unread).toMatch(/<button[^>]*disabled=""[^>]*>Make an invitation<\/button>/);
  });

  it("shows the guide a code opens, in its order, with every line to copy as it is (ADR-0088)", () => {
    const setup = {
      account: {
        handle: "mira",
        name: "<b>Mira</b>",
        title: "Release engineer",
        login: "carol",
        host: "gh" as const,
        avatarParts: null,
      },
      workspace: {
        name: "Acme",
        handle: "acme",
        domain: null,
        services: { git: { kind: "github", organization: "acme" } },
      },
      console: { url: "https://console.test" },
      expiresAt: "2026-11-17T14:02:11.000Z",
    };
    const guide = setupGuideOf(setup, "ABCD-EFGH");
    const seen = renderToStaticMarkup(<SetupGuideView guide={guide} account={setup.account} />);
    // What the account is called is words, never markup.
    expect(seen).toContain("Setting up @mira (&lt;b&gt;Mira&lt;/b&gt;, Release engineer)");
    expect(seen).not.toContain("<b>Mira</b>");
    expect(seen).toContain("signs in there as <code>carol</code> through GitHub");
    expect(seen).toContain("The invitation is good until");
    expect(seen).toContain("1. Before the line");
    expect(seen).toContain("Whoever prepares the machine");
    expect(seen).toContain("2. On the machine");
    // A person reads the guide whole: the machine's part, and what the agent does after it.
    expect(seen).toContain("Then stop");
    expect(seen).toContain("Signing in elsewhere, in a browser");
    expect(seen).toContain(
      '<pre class="sc-code">Set this machine up for an agent account. Install what is missing yourself, without asking: first Node.js 24 or later and the command (npm i -g @skillcdn/console). Then run console agent setup --console https://console.test --code ABCD-EFGH and do what it prints. Ask me only for a sign-in or an administrator&#x27;s password.</pre>',
    );
    // English says nothing of the guide's language; another language says the guide is English.
    expect(seen).not.toContain(" · </p>");
    const korean = renderToStaticMarkup(
      <LanguageContext.Provider value={KOREAN}>
        <SetupGuideView guide={guide} account={setup.account} />
      </LanguageContext.Provider>,
    );
    expect(korean).toContain("머신을 준비하는 사람");
    expect(korean).toContain("가이드 본문은 에이전트가 읽는 그대로 영어입니다");
    expect(korean).toContain("1. Before the line");
  });

  it("puts the agents that report to a person and are not running on that person's plate", () => {
    const agents = [
      {
        person: mira,
        manager: alice,
        supervised: true,
        state: standing("refused", "model_refused"),
      },
      {
        person: { ...mira, id: bob.id, handle: "dex", name: "Dex" },
        manager: alice,
        supervised: true,
        state: standing("running", "started"),
      },
      {
        person: { ...mira, id: CAROL, handle: "noor", name: "Noor" },
        manager: bob,
        supervised: true,
        state: standing("failed", "crashed"),
      },
      {
        person: {
          ...mira,
          id: "0199c4d8-0000-7000-8000-00000000000a",
          handle: "new",
          name: "Newcomer",
        },
        manager: alice,
        supervised: true,
        state: null,
      },
    ];
    const seen = renderToStaticMarkup(<AgentsNeedingYou agents={agents} me={alice.id} />);
    expect(seen).toContain("Agents that need you");
    expect(seen).toContain('href="/agents/mira"');
    expect(seen).toContain(">Refused<");
    // One that runs, one that reports to someone else, and one no runner said anything of yet.
    expect(seen).not.toContain("Dex");
    expect(seen).not.toContain("Noor");
    expect(seen).not.toContain("Newcomer");
    expect(renderToStaticMarkup(<AgentsNeedingYou agents={agents} me={CAROL} />)).toBe("");
    expect(renderToStaticMarkup(<AgentsNeedingYou agents={agents} me={undefined} />)).toBe("");
    const korean = renderToStaticMarkup(
      <LanguageContext.Provider value={KOREAN}>
        <AgentsNeedingYou agents={agents} me={alice.id} />
      </LanguageContext.Provider>,
    );
    expect(korean).not.toContain("Agents that need you");
    expect(korean).not.toContain(">Refused<");
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
    // A command that asks to be the account itself (ADR-0084): no agent to name and no token to
    // date, only whether whoever is signed in is who sits at that command.
    const itself = renderToStaticMarkup(
      <ConnectApproval
        request={{ ...request, as: "self" }}
        daysAtMost={30}
        onApprove={() => undefined}
        onDeny={() => undefined}
      />,
    );
    expect(itself).toContain("A command asks to sign in as you");
    expect(itself).toContain("Claude Code on &lt;the&gt; laptop");
    expect(itself).toContain("ABCD-EFGH");
    expect(itself).toContain(">This is me<");
    expect(itself).toContain(">Not mine<");
    expect(itself).not.toContain(">Approve<");
    expect(itself).not.toContain("<input");
    expect(itself).not.toContain("30 days");
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

  it("names a person's manager and the team a manager has, and lets an administrator set the manager", () => {
    const managed: RestPerson = { ...bob, managerId: alice.id };
    const read = renderToStaticMarkup(<PeopleList people={[alice, managed]} me={bob} />);
    expect(read).toMatch(/<dt>Manager<\/dt><dd><span class="sc-person"[^>]*>.*?Alice Example/);
    expect(read).toMatch(
      /<dt>Direct reports<\/dt><dd><span class="sc-person-reports" title="bob"><span class="sc-workers">/,
    );
    expect(read).toContain(">1 person</span>");
    expect(read).toMatch(/<dt>Manager<\/dt><dd><span class="sc-muted">None/);
    expect(read).not.toContain("<select");
    const change = renderToStaticMarkup(
      <PeopleList people={[alice, managed]} me={alice} onChangeManager={() => undefined} />,
    );
    // A picker per person (ADR-0037): the manager as it stands in the field's place, or the
    // field that searches everyone but themselves.
    expect(change).not.toContain("<select");
    expect(change.match(/role="combobox"/g)).toHaveLength(1);
    expect(change).toContain('aria-label="Manager of Alice Example"');
    expect(change).toContain('placeholder="None"');
    expect(change).toMatch(/sc-picker-chosen[\s\S]*?Alice Example/);
    // Changed in place, the manager reads as a fact does until the pointer or the focus is on it.
    expect(change.match(/class="sc-picker sc-picker-quiet"/g)).toHaveLength(1);
    expect(change.match(/class="sc-picker sc-picker-chosen sc-picker-quiet"/g)).toHaveLength(1);
  });

  it("says what a member does under their name, marks an agent account, and lets whoever may write a title (ADR-0084)", () => {
    const mira: RestPerson = {
      ...bob,
      id: "0199c4d8-0000-7000-8000-000000000009",
      login: "carol",
      name: "Mira",
      kind: "agent",
      handle: "mira",
      title: "Release engineer",
      managerId: bob.id,
      invited: true,
      avatarParts: {
        set: 1,
        palette: 0,
        ground: 0,
        form: 1,
        material: 0,
        accent: 0,
        vein: 7,
      },
    };
    const read = renderToStaticMarkup(<PeopleList people={[alice, bob, mira]} me={alice} />);
    expect(read).toContain('<span class="sc-person-card-title">Release engineer</span>');
    // Its picture is drawn from its parts, where a person's is the provider's or an initial.
    expect(read).toMatch(
      /<img class="sc-avatar-drawn sc-avatar sc-avatar-lg" src="data:image\/png;base64,[A-Za-z0-9+/=]+" width="128" height="128" alt=""/,
    );
    expect(read.match(/<img class="sc-avatar-drawn sc-avatar sc-avatar-lg"/g)).toHaveLength(1);
    // The account is called by its handle, said to be an agent, and to be waiting for its sign-in.
    expect(read).toMatch(/Mira<span class="sc-badge sc-badge-neutral"[^>]*>Agent<\/span>/);
    expect(read).toContain("@mira · carol · Invited, not signed in yet");
    // The people first and the agent accounts after them, each under its heading with how many.
    expect(read).toMatch(
      /aria-label="People"><h2 class="sc-section-title">People<span class="sc-badge sc-badge-neutral sc-badge-kind-count">2<\/span><\/h2>/,
    );
    expect(read).toMatch(
      /aria-label="Agent accounts"><h2 class="sc-section-title">Agent accounts<span class="sc-badge sc-badge-neutral sc-badge-kind-count">1<\/span><\/h2>/,
    );
    expect(read.indexOf('aria-label="People"')).toBeLessThan(
      read.indexOf('aria-label="Agent accounts"'),
    );
    // Where there are people alone, they stand under the page's own title.
    const peopleAlone = renderToStaticMarkup(<PeopleList people={[alice, bob]} me={alice} />);
    expect(peopleAlone).not.toContain("sc-section-title");
    expect(peopleAlone).toContain('aria-label="People"');
    // An agent account's name and a way at the foot of its card lead to its own page.
    const linked = renderToStaticMarkup(
      <PeopleList
        people={[alice, bob, mira]}
        me={alice}
        agentHref={(person) => `/agents/${person.handle}`}
        agentsHref={(person) => `/people/${person.id}/agents`}
      />,
    );
    expect(linked).toContain('<a class="sc-person-card-link" href="/agents/mira">Mira</a>');
    expect(linked).toContain('href="/agents/mira">Its page</a>');
    // A person's agents are a person's: none are listed of an agent account.
    expect(linked.match(/\/agents">Agents<\/a>/g)).toHaveLength(2);
    expect(read).not.toContain("<dt>Title</dt>");
    // An administrator writes anyone's; an agent account's role is read, never chosen.
    const administered = renderToStaticMarkup(
      <PeopleList
        people={[alice, bob, mira]}
        me={alice}
        onChangeRole={() => undefined}
        onChangeTitle={() => undefined}
      />,
    );
    expect(administered.match(/<dt>Title<\/dt>/g)).toHaveLength(3);
    expect(administered).toContain('aria-label="Title of Mira"');
    expect(administered).toContain('value="Release engineer"');
    expect(administered.match(/<select/g)).toHaveLength(2);
    // A supervisor writes the title of the agent account below them, and nobody else's.
    expect(supervisedBy(bob, mira, [alice, bob, mira])).toBe(true);
    expect(supervisedBy(alice, mira, [alice, bob, mira])).toBe(false);
    expect(supervisedBy(alice, mira, [alice, { ...bob, managerId: alice.id }, mira])).toBe(true);
    expect(supervisedBy(alice, { ...bob, managerId: alice.id }, [alice, bob])).toBe(false);
    const supervised = renderToStaticMarkup(
      <PeopleList
        people={[alice, bob, mira]}
        me={bob}
        onChangeTitle={() => undefined}
        mayChangeTitle={(person) => supervisedBy(bob, person, [alice, bob, mira])}
      />,
    );
    expect(supervised.match(/<dt>Title<\/dt>/g)).toHaveLength(1);
    expect(supervised).toContain('aria-label="Title of Mira"');
  });

  it("names the teams a person is in as chips, and lets an administrator put them in one from their card (ADR-0073)", () => {
    const team = {
      id: "0199c4d8-0000-7000-8000-000000000071",
      key: "platform",
      name: "Platform",
      memberIds: [bob.id],
      createdAt: "2026-11-02T01:00:00.000Z",
    };
    const read = renderToStaticMarkup(<PeopleList people={[alice, bob]} me={bob} teams={[team]} />);
    expect(read).toMatch(/<dt>Teams<\/dt><dd><div class="sc-chips"><span class="sc-chip">/);
    expect(read).toContain('<span class="sc-chip-label">Platform</span>');
    expect(read).not.toContain("sc-chip-remove");
    expect(read).not.toContain('role="combobox"');
    // Nobody in a team and nothing to add: no row of teams on the card.
    expect(read.match(/<dt>Teams<\/dt>/g)).toHaveLength(1);
    const kept = renderToStaticMarkup(
      <PeopleList
        people={[alice, bob]}
        me={alice}
        teams={[team]}
        onJoinTeam={() => undefined}
        onLeaveTeam={() => undefined}
      />,
    );
    expect(kept).toContain('aria-label="Take bob out of Platform"');
    expect(kept).toMatch(
      /class="sc-picker sc-picker-add"><input[^>]*aria-label="Add Alice Example to a team"/,
    );
    expect(kept).not.toContain('aria-label="Add bob to a team"');
    // The teams themselves are kept on a view of their own.
    expect(kept).not.toContain("New team");
    expect(renderToStaticMarkup(<PeopleList people={[alice]} teams={[]} />)).not.toContain("Teams");
  });

  it("shows the teams as cards, with who is in each, and lets an administrator keep them (ADR-0073)", () => {
    const platform = {
      id: "0199c4d8-0000-7000-8000-000000000071",
      key: "platform",
      name: "Platform",
      memberIds: [bob.id],
      createdAt: "2026-11-02T01:00:00.000Z",
    };
    const design = {
      ...platform,
      id: "0199c4d8-0000-7000-8000-000000000072",
      key: "design",
      name: "Design",
      memberIds: [],
    };
    const read = renderToStaticMarkup(
      <TeamList teams={[design, platform]} people={[alice, bob]} />,
    );
    expect(read).toContain('<h2 class="sc-team-name">Design</h2>');
    // Each team says its key (ADR-0074), what a grant, a plugin and the command call it by.
    expect(read).toMatch(/<span class="sc-fine-faint"[^>]*>platform<\/span>/);
    expect(read).toContain("1 member");
    expect(read).toContain("0 members");
    expect(read).toContain("Nobody in it yet.");
    expect(read).toMatch(
      /<span class="sc-chip"><span class="sc-chip-label"><span class="sc-person" title="bob">/,
    );
    expect(read).not.toContain("<input");
    expect(read).not.toContain("<button");
    const kept = renderToStaticMarkup(
      <TeamList
        teams={[design, platform]}
        people={[alice, bob]}
        onRename={() => undefined}
        onRemove={() => undefined}
        onAddMember={() => undefined}
        onRemoveMember={() => undefined}
      />,
    );
    expect(kept).toContain('aria-label="Name of the team Platform"');
    expect(kept).toContain('value="Platform"');
    expect(kept).toContain('aria-label="Take bob out of Platform"');
    // A person is added from the end of the team's row, searched among those in and not in it.
    expect(kept).toContain('aria-label="Add a person to Platform"');
    expect(kept).toContain('aria-label="Add a person to Design"');
    expect(kept.match(/>Delete team</g)).toHaveLength(2);
    expect(kept).not.toContain("Nobody in it yet.");
    expect(renderToStaticMarkup(<TeamList teams={[]} people={[alice]} />)).toContain(
      "No teams yet",
    );
  });

  it("makes a team by its name", () => {
    const form = renderToStaticMarkup(
      <TeamForm onSubmit={() => undefined} onCancel={() => undefined} />,
    );
    expect(form).toContain('aria-label="New team"');
    expect(form).toContain("Team name");
    // The key is asked beside the name, in a project key's shape, and stays once the team is made.
    expect(form).toMatch(/<span class="sc-field-label">Key<\/span><input[^>]*pattern="\[a-z0-9\]/);
    expect(form).toMatch(/<button disabled="" type="submit"[^>]*>Make the team</);
    expect(form).toContain(">Cancel<");
  });

  it("shows a person's work email where the console answers one, and lets an administrator write it (ADR-0069)", () => {
    const mailed: RestPerson = { ...bob, email: "bob@example.test" };
    const read = renderToStaticMarkup(<PeopleList people={[alice, mailed]} me={bob} />);
    expect(read).toMatch(/<dt>Work email<\/dt><dd><span class="sc-person-email">bob@example.test/);
    expect(read).not.toContain('type="email"');
    // A person the console answers no address for has no row; an administrator writes everyone's.
    expect(read.match(/<dt>Work email<\/dt>/g)).toHaveLength(1);
    const change = renderToStaticMarkup(
      <PeopleList people={[alice, mailed]} me={alice} onChangeEmail={() => undefined} />,
    );
    expect(change.match(/type="email"/g)).toHaveLength(2);
    expect(change).toContain('value="bob@example.test"');
    expect(change).toContain('aria-label="Work email of bob"');
    // A quiet field, its hint on hover: where an address comes from, and who reads it.
    expect(change.match(/class="sc-input sc-input-quiet"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(change).toContain("Read by an administrator, the person, and a plugin allowed to.");
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
    // A person the organization let in is of it by the organization's name, set apart from
    // their own login, so that the login is never read as the organization's name.
    const ofIt = renderToStaticMarkup(
      <PeopleList
        people={[
          { ...alice, source: "organization" },
          { ...dave, name: "Dave Example" },
          {
            ...bob,
            id: "0199c4d8-0000-7000-8000-000000000005",
            login: "erin@acme.test",
            name: "Erin Example",
            source: "domain",
          },
        ]}
        organization={{ host: "gh", name: "acme", syncedAt: null }}
      />,
    );
    expect(ofIt).toContain('<span class="sc-person-card-note">alice · Member of acme</span>');
    expect(ofIt).toContain('dave · <span class="sc-person-note">Left the organization');
    expect(ofIt).toContain(
      '<span class="sc-person-card-note">erin@acme.test · Account at acme.test</span>',
    );
    expect(ofIt).not.toContain("Of the organization");
    expect(ofIt).not.toContain("Of the domain");
    // Without the organization named by the console, the plain words stand.
    const plain = renderToStaticMarkup(
      <PeopleList people={[{ ...alice, source: "organization" }]} />,
    );
    expect(plain).toContain("Of the organization");
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
      plugin: null,
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
      {
        id: "0199c4d8-0000-7000-8000-000000000046",
        body: "The board after: ![after](board.png), and ![elsewhere](https://img.example/x.png).",
        createdAt: "2026-10-09T10:05:30.000Z",
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
      {
        id: "0199c4d8-0000-7000-8000-000000000044",
        kind: "file",
        url: null,
        label: "the board",
        file: {
          name: "board.png",
          size: 582940,
          contentType: "image/png",
          sha256: "cd".repeat(32),
        },
        createdAt: "2026-10-09T10:08:00.000Z",
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
    // A picture handed in is a thumbnail that opens large, named under it; a report that names
    // it by its file name shows it where the words are, and a picture over https stays as it is.
    expect(html).toContain('class="sc-picture-thumb" aria-label="Open the picture board.png"');
    expect(html).toContain(
      'src="/api/v1/projects/web/files/0199c4d8-0000-7000-8000-000000000044" alt="the board"',
    );
    expect(html).toContain(
      'src="/api/v1/projects/web/files/0199c4d8-0000-7000-8000-000000000044" alt="after"',
    );
    expect(html).toContain('src="/api/v1/pictures?src=https%3A%2F%2Fimg.example%2Fx.png"');
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
    expect(unlinked).not.toContain("sc-picture-thumb");
    expect(unlinked).toContain("board.png");
    expect(unlinked).toContain('<span class="sc-prose-image-text">after</span>');
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
      plugin: null,
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
    packToken: null,
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

  /** The front page with the projects given, kept as an icon and a card by the layout given. */
  const home = (projects: readonly RestProject[], props?: Partial<HomeGridProps>) =>
    renderToStaticMarkup(
      <HomeGrid
        projects={projects}
        plugins={[]}
        home={null}
        editing={false}
        onSave={() => Promise.resolve()}
        onDone={() => undefined}
        projectHref={(item) => `/projects/${item.key}`}
        onOpen={() => undefined}
        nameOf={(name) => name.en ?? ""}
        renderWidget={() => null}
        {...props}
      />,
    );

  it("stands each project as an icon that opens it, what waits on its corner, as text", () => {
    const ops = project({
      id: "0199c4d8-0000-7000-8000-000000000051",
      key: "ops",
      name: "Ops",
      role: "member",
      visibility: "workspace",
      description: "",
      openDecisions: 0,
      openRuns: 0,
    });
    const html = home([project(), ops]);
    expect(html).toContain('href="/projects/web"');
    // The page nobody arranged is drawn on the grid, and its grid is not hidden as an empty
    // page's is: only a page with nothing on it shows what stands for none.
    expect(html).toMatch(/<ul class="sc-home-grid"[^>]*data-columns="\d+"(?![^>]*hidden)[^>]*>/);
    const nothing = home([], { empty: <p>Nothing here</p> });
    expect(nothing).toContain("Nothing here");
    expect(nothing).toMatch(/<ul class="sc-home-grid"[^>]*hidden/);
    expect(html).not.toContain("Nothing here");
    expect(html).toContain("The web &lt;app&gt;");
    expect(html).not.toContain("<app>");
    expect(html).toContain("2 decisions waiting");
    expect(html.match(/sc-tile-count/g)).toHaveLength(1);
    expect(html).not.toContain("at work");
    // Each with its mark: the first letter of its name on a colour from its key, unless it names its own.
    expect(html).toContain('class="sc-mark sc-mark-lg sc-category-');
    expect(html).toContain(">T</span>");
    expect(html).not.toContain("What we ship.");
    // As a card, what it is too.
    const card = home([project(), ops], {
      home: {
        hidden: [],
        layouts: {
          8: [
            { tile: `project:${project().id}`, x: 0, y: 0, size: "small" },
            { tile: `project:${ops.id}`, x: 2, y: 0, size: "small" },
          ],
        },
      },
    });
    expect(card).toContain("What we ship.");
    expect(card).toContain("Owner");
    expect(card).toContain("Member");
    expect(card).toContain("Private");
    // What is not private says so, in so many words: a project is never open by accident.
    expect(card).toContain("Open to everyone");
    const marked = renderToStaticMarkup(
      <ProjectMark project={project({ color: "teal", symbol: "W2" })} size="lg" />,
    );
    expect(marked).toContain("sc-mark-lg sc-category-teal");
    expect(marked).toContain(">W2</span>");
    const chosen = renderToStaticMarkup(<ProjectMark project={project()} />);
    expect(chosen).toBe(renderToStaticMarkup(<ProjectMark project={project()} />));
    expect(chosen).not.toContain("sc-category-gray");
    expect(home([], { empty: <p>none</p> })).toContain("<p>none</p>");
  });

  it("offers, while the page is arranged, to put it back as nobody arranged it, where there is something to put back (ADR-0109)", () => {
    const reset = (html: string) => /<button[^>]*>Reset to default<\/button>/.exec(html)?.[0];
    // Not arranging, there is no such button.
    expect(reset(home([project()]))).toBeUndefined();
    // Arranging a page that stands as nobody arranged it, there is nothing to put back.
    expect(reset(home([project()], { editing: true }))).toContain('disabled=""');
    const kept = {
      hidden: [],
      layouts: { 8: [{ tile: `project:${project().id}`, x: 3, y: 1, size: "icon" as const }] },
    };
    const button = reset(home([project()], { editing: true, home: kept }));
    expect(button).toBeDefined();
    expect(button).not.toContain("disabled");
    // A tile taken off is something to put back too.
    const off = reset(
      home([project()], { editing: true, home: { hidden: ["widget:a:b"], layouts: {} } }),
    );
    expect(off).not.toContain("disabled");
  });

  it("draws the page nobody arranged on the very cells arranging shows, each widget at the size it starts at (ADR-0147)", () => {
    const people = {
      key: "people",
      state: "enabled",
      widgets: [
        {
          key: "notices",
          name: { en: "Notices" },
          place: "home:top",
          size: "half",
          sizes: ["medium", "large", "full"],
          defaultSize: "large",
        },
        {
          key: "leave",
          name: { en: "My leave" },
          place: "home:top",
          size: "third",
          sizes: ["small", "medium", "large"],
          defaultSize: "medium",
        },
        {
          key: "away",
          name: { en: "Away today" },
          place: "home:top",
          size: "third",
          sizes: ["small", "medium", "large"],
          defaultSize: "medium",
        },
      ],
    } as unknown as RestPlugin;
    const three = [1, 2, 3].map((at) =>
      project({ id: `0199c4d8-0000-7000-8000-00000000006${at}`, key: `p${at}`, name: `P${at}` }),
    );
    const page = (editing: boolean) =>
      home(three, {
        plugins: [people],
        editing,
        renderWidget: (tile, size) => <i>{`${tile.widget.key} at ${size}`}</i>,
      });
    const cells = (html: string) =>
      Object.fromEntries(
        [...html.matchAll(/data-tile="([^"]+)" style="([^"]*)"/g)].map(([, tile, style]) => [
          tile,
          style,
        ]),
      );
    const shown = cells(page(false));
    expect(Object.keys(shown)).toHaveLength(6);
    // What a person looks at is what they start to arrange, tile for tile, so that the page Done
    // keeps after Reset to default is the one they saw.
    expect(cells(page(true))).toEqual(shown);
    // Each widget on the cells of the size its plugin starts it at, and told that size: no lead
    // drawn half the page, no widget grown to close a row.
    expect(shown["widget:people:notices"]).toBe(
      "--sc-tile-x:0;--sc-tile-y:0;--sc-tile-w:4;--sc-tile-h:4",
    );
    expect(shown["widget:people:away"]).toBe(
      "--sc-tile-x:4;--sc-tile-y:2;--sc-tile-w:4;--sc-tile-h:2",
    );
    expect(page(false)).toContain("notices at large");
    expect(page(false)).toContain("away at medium");
  });

  it("shows a project at a glance from one answer: its figures, its tasks in progress, its goals and what waits for review (ADR-0105, ADR-0107)", () => {
    const web = project({ openDecisions: 1 });
    const tile = `project:${web.id}`;
    // The day the page itself calls today: the machine's, whatever its time zone.
    const now = today();
    const row = (
      id: string,
      title: string,
      state: "in_progress" | "in_review",
      dueOn: string | null,
    ) => ({
      id,
      number: 7,
      title,
      state,
      dueOn,
      workers: [],
    });
    const glance: ProjectGlance = {
      taskCounts: { idea: 0, ready: 1, in_progress: 5, in_review: 1, done: 2, dropped: 0 },
      // The decisions of the answer, which is newer than the project's own figure.
      openDecisions: 2,
      // As the console orders them: the sooner due first, the one due on no day after.
      inProgress: {
        items: [
          row("0199c4d8-0000-7000-8000-0000000000a2", "Work due <today>", "in_progress", now),
          row("0199c4d8-0000-7000-8000-0000000000a1", "Undated work", "in_progress", null),
        ],
        total: 5,
      },
      inReview: {
        items: [row("0199c4d8-0000-7000-8000-0000000000a3", "Read the copy", "in_review", null)],
        total: 1,
      },
      goals: {
        items: [
          {
            id: "0199c4d8-0000-7000-8000-0000000000b1",
            title: "Launch",
            state: "active",
            dueOn: null,
            taskCounts: { idea: 0, ready: 1, in_progress: 1, in_review: 1, done: 2, dropped: 0 },
          },
        ],
        // More goals ahead than the answer carries rows of.
        total: 4,
      },
    };
    const at = (size: "medium" | "large" | "wide", read: ProjectGlance = glance) =>
      home([web], {
        home: { hidden: [], layouts: { 8: [{ tile, x: 0, y: 0, size }] } },
        glances: { [web.id]: read },
      });
    const large = at("large");
    expect(large).toContain("sc-tile-glance");
    // The three figures are the answer's own, the decisions among them.
    expect(large).toContain("<dt>In progress</dt><dd>5</dd>");
    expect(large).toContain("<dt>In review</dt><dd>1</dd>");
    expect(large).toContain("<dt>Decisions</dt><dd>2</dd>");
    expect(large).toContain("Tasks in progress");
    // In the order they came, the day of the one due today said and the other with none.
    expect(large.indexOf("Work due &lt;today&gt;")).toBeLessThan(large.indexOf("Undated work"));
    expect(large).not.toContain("<today>");
    expect(large).toContain("Due today");
    // Three in progress are not among the rows: the line says so, from the answer's total.
    expect(large).toContain("3 more");
    expect(large).toContain("Launch");
    expect(large).toContain(">2/5<");
    // And three goals are ahead beyond the one read, not none: the line takes the room what
    // waits for review would have had.
    expect(large.match(/3 more/g)).toHaveLength(2);
    expect(large).not.toContain("Waiting for review");
    // With the one goal there is, what waits for review has its rows.
    const reviewed = at("large", { ...glance, goals: { ...glance.goals, total: 1 } });
    expect(reviewed.match(/3 more/g)).toHaveLength(1);
    expect(reviewed).toContain("Waiting for review");
    expect(reviewed).toContain("Read the copy");
    // The tile is one link, named by the project and its figures and not by every row; nothing
    // in it is a heading, and a goal's bar is a picture of the figure beside it.
    expect(large).toContain(
      'aria-label="The web &lt;app&gt; (web). In progress 5, in review 1, decisions waiting 2."',
    );
    expect(large).not.toContain("<h3");
    expect(large).not.toContain('role="progressbar"');
    expect(large).toContain('<div class="sc-progress-bar" aria-hidden="true">');
    // On a wide tile, the head is a column of its own with what the project is.
    const wide = at("wide");
    expect(wide).toContain("sc-tile-glance-wide");
    expect(wide).toContain("sc-glance-about");
    // Before its board is read, the head alone: the decisions the project knows of, and a dash
    // where a figure is not read yet.
    const unread = home([web], {
      home: { hidden: [], layouts: { 8: [{ tile, x: 0, y: 0, size: "medium" }] } },
    });
    expect(unread).toContain("sc-tile-glance");
    expect(unread).not.toContain("Tasks in progress");
    expect(unread).toContain("<dt>In progress</dt><dd>\u2013</dd>");
    expect(unread).toContain("<dt>Decisions</dt><dd>1</dd>");
    expect(unread).toContain('aria-label="The web &lt;app&gt; (web). Decisions waiting 1."');
    // Arranged, it is no link and has no name of its own: its words are read as they stand.
    const arranged = home([web], {
      editing: true,
      home: { hidden: [], layouts: { 8: [{ tile, x: 0, y: 0, size: "large" }] } },
      glances: { [web.id]: glance },
    });
    expect(arranged).not.toContain("In progress 5, in review 1");
  });

  it("opens nothing while the page is arranged, and gives each tile the way off it and its sizes", () => {
    const html = home([project()], { editing: true });
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("href=");
    expect(html).toContain("sc-home-editing");
    expect(html).toContain('aria-label="Remove from this page: The web &lt;app&gt;"');
    // A tile a cell wide has one button for its sizes, which says the size it has and opens the
    // list of them over the tiles: a row of them, folded into the cell, would cover the icon.
    // It shows the pack's "more", not a size lit, which read as a choice already made.
    const one = html.match(
      /<button type="button" class="sc-tile-size" aria-label="Size: Icon"[^>]* aria-expanded="false" aria-controls="([^"]+)" popovertarget="\1">(.*?)<\/button>/i,
    );
    expect(one).not.toBeNull();
    expect(one?.[2]).toMatch(/^<svg class="sc-icon sc-icon-md"[^>]* aria-hidden="true">/);
    expect(one?.[2]).not.toContain("sc-tile-size-glyph");
    expect(html).not.toContain("sc-tile-size-on");
    expect(html).not.toContain("sc-tile-sizes");
    expect(html.match(/class="sc-tile-size[ "]/g)).toHaveLength(1);
    expect(html).toMatch(/<div id="[^"]+" popover="auto" class="sc-menu-panel sc-menu-popover/);
    expect(html).toMatch(
      /<button[^>]* class="sc-menu-link sc-home-size-option sc-menu-chosen" aria-pressed="true">.*?Icon<\/button>/,
    );
    expect(html).toMatch(
      /<button[^>]* class="sc-menu-link sc-home-size-option" aria-pressed="false">.*?Small<\/button>/,
    );
    // A tile wider than a cell has the row of its sizes, each a button of its own.
    const card = home([project()], {
      editing: true,
      home: {
        hidden: [],
        layouts: { 8: [{ tile: `project:${project().id}`, x: 0, y: 0, size: "small" }] },
      },
    });
    expect(card).toContain('aria-pressed="true" aria-label="Small"');
    expect(card).toContain('aria-pressed="false" aria-label="Icon"');
    expect(card).not.toContain("popover=");
    expect(html).toContain(">Done</button>");
    expect(html).toContain(">Cancel</button>");
    // What the person took off waits to be added back.
    const taken = home([project()], {
      editing: true,
      home: { hidden: [`project:${project().id}`], layouts: {} },
    });
    expect(taken).toContain("+ The web &lt;app&gt;");
    expect(taken).not.toContain('class="sc-tile"');
  });

  it("draws only the frames of the widgets of a plugin that is on", () => {
    const hello = {
      key: "hello",
      state: "enabled",
      widgets: [
        {
          key: "latest",
          name: { en: "Latest" },
          place: "home:top",
          size: "third",
          sizes: ["small", "medium"],
          defaultSize: "small",
        },
      ],
    } as unknown as RestPlugin;
    const drawn = (plugin: RestPlugin) =>
      home([], {
        plugins: [plugin],
        renderWidget: (tile, size) => <i>{`frame of ${tile.widget.key} at ${size}`}</i>,
      });
    // Alone on a page nobody arranged, it stands at the size it starts at, and is told it: no
    // larger one is chosen to fill the row (ADR-0147).
    expect(drawn(hello)).toContain("frame of latest at small");
    expect(drawn(hello)).toContain(">Latest</h2>");
    expect(drawn({ ...hello, state: "disabled" })).not.toContain("frame of");
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
    // Whom to add is searched for among those not listed yet (ADR-0037).
    expect(change).toContain('placeholder="Choose someone"');
    expect(change).toContain('aria-label="Person"');
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
  const review = {
    name: "review",
    description: "Reviews a <change>.",
    directory: "review",
    path: "review/SKILL.md",
    page: "https://skillcdn.test/gh/acme/skills?skill=review%2FSKILL.md",
    uri: "skill://gh/acme/skills/review/SKILL.md",
    translations: {},
  };
  const served = {
    address: "/gh/acme/skills",
    source: "https://skillcdn.test",
    page: "https://skillcdn.test/gh/acme/skills",
    status: "ready" as const,
    refusal: null,
    mount: null,
    items: [review],
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
          refusal: null,
          items: [],
          mount: null,
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

  it("say when the pack is read from a directory on the console's machine, and link nothing then (ADR-0031)", () => {
    const local = renderToStaticMarkup(
      <SkillList
        skills={{
          ...served,
          address: "/local/acme/skills",
          source: null,
          page: null,
          items: [{ ...review, page: null, uri: "skill://local/acme/skills/review/SKILL.md" }],
        }}
      />,
    );
    expect(local).toContain("Read from a directory on the console");
    expect(local).toContain("/local/acme/skills");
    expect(local).toContain("skill://local/acme/skills/review/SKILL.md");
    expect(local).not.toContain("href=");
    const missing = renderToStaticMarkup(
      <SkillList
        skills={{
          ...served,
          address: "/local/acme/skills",
          source: null,
          page: null,
          status: "not_found",
          items: [],
        }}
      />,
    );
    expect(missing).toContain("No pack is served from the console");
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
          folded={[]}
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
      workers: [alice, bob],
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
    // A task is kept for any of its workers.
    expect(filterTasks(all, { person: bob.id })).toEqual([a, mine]);
    expect(filterTasks(all, { mine: true }, alice)).toEqual([mine]);
    expect(filterTasks(all, { mine: true })).toEqual([]);
    // Words, as they are typed: every one of them in the title, the number, a person or the
    // category, whatever the case; a worker's login and an owner's name count.
    expect(filterTasks(all, { words: "ALICE" })).toEqual([a, mine]);
    expect(filterTasks(all, { words: "#5" })).toEqual([mine]);
    expect(filterTasks(all, { words: " ship  #1 " })).toEqual([a]);
    expect(filterTasks(all, { words: "engineering bob" })).toEqual([mine]);
    expect(filterTasks(all, { words: "nobody" })).toEqual([]);
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
    expect(html).toContain('type="search"');
    expect(html).toContain('placeholder="Title, number or person"');
    expect(html).toContain("1 of 2 tasks");
    expect(html).toContain("Show everything");
    // The goal and the person are searched for (ADR-0037); what the address names stands in the field's place.
    expect(html).toContain('placeholder="Any goal"');
    expect(html).toContain('placeholder="Everyone"');
    expect(html).not.toContain("<select[^>]*Ship v1");
    const narrowed = renderToStaticMarkup(
      <BoardFilters
        filter={{ goal: goal().id, mine: true }}
        categories={[engineering]}
        goals={[goal()]}
        people={[alice, bob]}
        me={alice}
        shown={1}
        total={2}
        onChange={() => undefined}
      />,
    );
    expect(narrowed).toContain("Ship v1");
    expect(narrowed).toContain("Mine");
    expect(narrowed.match(/sc-picker-chosen/g)).toHaveLength(2);
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
          archivedAt: null,
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

describe("a badge's kind", () => {
  it("is in its class, so that the stylesheet shapes a state, a priority and a due day apart", () => {
    const html = renderToStaticMarkup(
      <>
        <StateBadge state="in_progress" />
        <PriorityBadge priority="high" />
        <DueBadge dueOn={TODAY} state="ready" today={TODAY} />
      </>,
    );
    expect(html).toContain('class="sc-badge sc-badge-accent sc-badge-kind-state"');
    expect(html).toContain('class="sc-badge sc-badge-point sc-badge-kind-priority"');
    expect(html).toContain('class="sc-badge sc-badge-point sc-badge-kind-due sc-badge-due-today"');
    const tomorrow = renderToStaticMarkup(
      <DueBadge dueOn="2026-10-12" state="ready" today={TODAY} />,
    );
    expect(tomorrow).toContain('class="sc-badge sc-badge-point sc-badge-kind-due"');
  });
});

describe("the calendar", () => {
  it("lists a day's tasks once its number is pressed: those on the day and those lying across it, the open ones first", () => {
    const across = task({
      id: "0199c4d8-0000-7000-8000-000000000021",
      number: 2,
      title: "Across",
      startsOn: "2026-10-12",
      dueOn: "2026-10-16",
    });
    const onIt = task({
      id: "0199c4d8-0000-7000-8000-000000000022",
      number: 5,
      title: "On it",
      dueOn: "2026-10-14",
      state: "done",
    });
    const elsewhere = task({
      id: "0199c4d8-0000-7000-8000-000000000023",
      number: 7,
      title: "Elsewhere",
      dueOn: "2026-10-15",
    });
    expect(tasksOn("2026-10-14", [elsewhere, onIt, across]).map((one) => one.number)).toEqual([
      2, 5,
    ]);
    expect(tasksOn("2026-10-11", [elsewhere, onIt, across])).toEqual([]);
    const html = renderToStaticMarkup(
      <Calendar
        tasks={[across, onIt, elsewhere]}
        month="2026-10"
        today={TODAY}
        taskHref={href}
        monthHref={() => "#"}
      />,
    );
    // Every number is a button, none pressed, and no day is listed until one is.
    expect(html).toContain('class="sc-calendar-day" aria-pressed="false"');
    expect(html).not.toContain('aria-pressed="true"');
    expect(html).not.toContain("sc-calendar-day-list");
    // A phone's count, where a day holds more than it shows: the bar and the task on the 14th are two, under the three.
    expect(html).not.toContain("sc-calendar-count");
  });

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
      task({ workers: [bob], dueOn: "2026-10-09", state: "in_progress" }),
      task({ id: "0199c4d8-0000-7000-8000-000000000011", workers: [bob], dueOn: "2026-10-15" }),
      task({ id: "0199c4d8-0000-7000-8000-000000000012", workers: [], dueOn: null }),
      task({ id: "0199c4d8-0000-7000-8000-000000000013", workers: [alice], state: "done" }),
      task({ id: "0199c4d8-0000-7000-8000-000000000014", workers: [alice], dueOn: "2026-10-30" }),
    ];
    // The week from Sunday the 11th: Thursday the 15th is this week's.
    const rows = workloadOf(tasks, TODAY, 7);
    expect(rows.map((row) => row.person?.login ?? null)).toEqual(["alice", "bob", null]);
    expect(rows[1]).toMatchObject({ open: 2, inProgress: 1, dueThisWeek: 1, overdue: 1 });
    expect(rows[0]).toMatchObject({ open: 1, inProgress: 0, dueThisWeek: 0, overdue: 0 });
    // The week from Monday: Sunday the 11th ends it, and the 15th is next week's (ADR-0039).
    expect(workloadOf(tasks, TODAY, 1)[1]).toMatchObject({ dueThisWeek: 0 });
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
      closed: [
        {
          project: { key: "docs", name: "The docs", color: "green", symbol: "D", icon: null },
          task: task({
            id: "0199c4d8-0000-7000-8000-000000000015",
            number: 10,
            dueOn: TODAY,
            title: "Done today",
            state: "done",
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
    const first = weekOf(TODAY, firstDayOfWeek(deviceLanguage("en")))[0] ?? "";
    expect(html).toContain('aria-label="The week"');
    expect(html).toContain("sc-calendar-cell-today");
    expect(html).toContain(`href="/work?week=${addDays(first, -7)}"`);
    expect(html).toContain(`href="/work?week=${addDays(first, 7)}"`);
    expect(html).toMatch(
      /class="sc-calendar-task[^"]*"[^>]*><span class="sc-mark sc-mark-sm sc-category-green"[^>]*>D<\/span><span class="sc-calendar-task-title">On the day/,
    );
    // What was done is on the week, struck through as a project's calendar shows it, and in no list.
    expect(html).toMatch(
      /class="sc-calendar-task[^"]*sc-calendar-over[^"]*"[^>]*>[\s\S]{0,400}?Done today/,
    );
    expect(html.split("Done today").length - 1).toBe(1);
    expect(html).toContain('href="/projects/docs/tasks/10"');
    const quiet = renderToStaticMarkup(
      <WorkList
        work={{ tasks: [], decisions: [] }}
        today={TODAY}
        taskHref={() => "#"}
        decisionHref={() => "#"}
        weekHref={(day) => `/work?week=${day}`}
      />,
    );
    expect(quiet).toContain("No decision waits for your answer.");
    expect(quiet).toContain("Nothing is planned this week.");
    expect(quiet).not.toContain('aria-label="Overdue"');
    // Nothing open, but something closed this week: the week shows it, and the lists stay away.
    const onlyClosed = renderToStaticMarkup(
      <WorkList
        work={{ tasks: [], closed: work.closed, decisions: [] }}
        today={TODAY}
        taskHref={(key, item) => `/projects/${key}/tasks/${item.number}`}
        decisionHref={() => "#"}
        weekHref={(day) => `/work?week=${day}`}
      />,
    );
    expect(onlyClosed).toContain("Done today");
    expect(onlyClosed).not.toContain("Nothing is planned this week.");
    expect(onlyClosed).not.toContain('aria-label="Due this week"');
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
    expect(theirs).not.toContain('aria-label="Decisions waiting for you"');
    expect(theirs).not.toContain("No decision waits for your answer.");
    expect(quiet).toContain('aria-label="Decisions waiting for you"');
  });

  it("shows one week on its own, the weeks around a step away, in the person's language", () => {
    const first = weekOf("2026-10-14", firstDayOfWeek(deviceLanguage("en")))[0] ?? "";
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
    // The title of a bar with more than one day in the week runs along it from the first piece,
    // which says how many days it has; a bar of one day keeps the title within it.
    expect(html).toContain("sc-calendar-bar-spanning");
    expect(html).toMatch(/style="--sc-span:[2-7]"/);
    expect(html).toContain("sc-calendar-task-title sc-calendar-task-title-spanning");
    expect(html.match(/sc-calendar-bar-spanning/g)).toHaveLength(
      html.match(/--sc-span:/g)?.length ?? 0,
    );
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
        tasks={[task({ dueOn: "2026-10-14", workers: [] })]}
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
    expect(html).toContain("<dt>Workers</dt>");
    expect(html).toContain("bob");
    expect(html).toContain("<dt>Plan</dt>");
    expect(html).toContain("<dt>Started</dt>");
    expect(html).not.toContain("<dt>Done</dt>");
    expect(html).toContain("<dt>Written</dt>");
    expect(html).toContain("<dt>Changed</dt>");
    // Across projects the goals are unknown and the row is left out; what is not set is no row.
    const bare = renderToStaticMarkup(
      <TaskTip
        task={task({ workers: [], goalId: goal().id })}
        place={{ side: "below", shift: 0 }}
      />,
    );
    expect(bare).toContain("sc-task-tip-below");
    expect(bare).not.toContain("<dt>Goal</dt>");
    expect(bare).not.toContain("<dt>Plan</dt>");
    expect(bare).toContain("Nobody");
  });
});

describe("a task with no day of its plan (ADR-0159)", () => {
  /** A moment of a day by this machine's clock, as the board keeps one. */
  const at = (day: string, hour = 10): string =>
    new Date(`${day}T${String(hour).padStart(2, "0")}:00:00`).toISOString();
  const web = { key: "web", name: "The web app", color: null, symbol: null, icon: null };
  const n = (tasks: readonly RestTask[]) => tasks.map((one) => one.number);

  it("lies where it was worked, by the moments the board keeps, and a planned one on its plan", () => {
    const on = (day: string) => ({ from: day, to: day });
    // Written and taken at once: on the day it was started.
    expect(daysOf(task({ state: "in_progress", startedAt: at(TODAY) }), TODAY)).toEqual(on(TODAY));
    // Still at work days later: from that day through today, whatever run of it ended.
    for (const lastRunEndedAt of [null, at("2026-10-09")]) {
      expect(
        daysOf(task({ state: "in_progress", startedAt: at("2026-10-08"), lastRunEndedAt }), TODAY),
      ).toEqual({ from: "2026-10-08", to: TODAY });
    }
    // Its work ended with its last run, whatever became of it since: it waits for its review,
    // was given back, dropped, or passed days later.
    for (const state of ["idea", "ready", "in_review", "done", "dropped"] as const) {
      expect(
        daysOf(
          task({
            state,
            startedAt: at("2026-10-05"),
            lastRunEndedAt: at("2026-10-06"),
            doneAt: state === "done" ? at("2026-10-10") : null,
          }),
          TODAY,
        ),
      ).toEqual({ from: "2026-10-05", to: "2026-10-06" });
    }
    // A run left open by hand ended after the task was done: the work ended as it was done.
    expect(
      daysOf(
        task({
          state: "done",
          startedAt: at("2026-10-05"),
          doneAt: at("2026-10-07"),
          lastRunEndedAt: at("2026-10-09"),
        }),
        TODAY,
      ),
    ).toEqual({ from: "2026-10-05", to: "2026-10-07" });
    // Worked with no run, a card moved by hand, or said by a console of before, which names no
    // run's end: done, through the day it was done.
    expect(
      daysOf(task({ state: "done", startedAt: at("2026-10-05"), doneAt: at("2026-10-07") }), TODAY),
    ).toEqual({ from: "2026-10-05", to: "2026-10-07" });
    // The day is this machine's: the first and the last hour of a day are that day.
    expect(
      daysOf(
        task({ state: "done", startedAt: at("2026-10-07", 0), doneAt: at("2026-10-07", 23) }),
        TODAY,
      ),
    ).toEqual(on("2026-10-07"));
    // With no run that ended, given back, dropped or waiting for its review, nobody is at it:
    // the day it was started, alone.
    for (const state of ["idea", "ready", "in_review", "dropped"] as const) {
      expect(daysOf(task({ state, startedAt: at("2026-10-08") }), TODAY)).toEqual(on("2026-10-08"));
    }
    // Neither planned nor started, it lies nowhere, as before.
    expect(daysOf(task(), TODAY)).toBeUndefined();
    expect(daysOf(task({ state: "dropped" }), TODAY)).toBeUndefined();
    // Done before the board kept when it was started: the day it was done.
    expect(daysOf(task({ state: "done", doneAt: at("2026-10-07") }), TODAY)).toEqual(
      on("2026-10-07"),
    );
    // A reader whose clock is behind the board's sees it on their today, never on days turned round.
    expect(daysOf(task({ state: "in_progress", startedAt: at("2026-10-12") }), TODAY)).toEqual(
      on(TODAY),
    );
    // What is no moment places nothing.
    for (const startedAt of ["", "yesterday", "2026-13-45T99:00:00Z"]) {
      expect(daysOf(task({ state: "in_progress", startedAt }), TODAY)).toBeUndefined();
    }
    // A day of the plan decides where the task lies, whatever happened and when.
    const worked = {
      state: "done",
      startedAt: at("2026-10-05"),
      doneAt: at("2026-10-07"),
    } as const;
    expect(daysOf(task({ ...worked, dueOn: "2026-10-20" }), TODAY)).toEqual(on("2026-10-20"));
    expect(daysOf(task({ ...worked, startsOn: "2026-10-14" }), TODAY)).toEqual(on("2026-10-14"));
    expect(daysOf(task({ ...worked, startsOn: "2026-10-14", dueOn: "2026-10-16" }), TODAY)).toEqual(
      { from: "2026-10-14", to: "2026-10-16" },
    );
    expect(daysOf(task({ startsOn: "2026-10-14", dueOn: "2026-10-14" }), TODAY)).toEqual(
      on("2026-10-14"),
    );
  });

  const taken = task({
    id: "0199c4d8-0000-7000-8000-000000000051",
    number: 21,
    title: "Taken at once",
    state: "in_progress",
    startedAt: at(TODAY),
  });
  const waiting = task({
    id: "0199c4d8-0000-7000-8000-000000000052",
    number: 22,
    title: "Worked for days",
    state: "in_review",
    startedAt: at("2026-10-07"),
    lastRunEndedAt: at("2026-10-09"),
    category: engineering,
  });
  const finished = task({
    id: "0199c4d8-0000-7000-8000-000000000053",
    number: 23,
    title: "Finished last week",
    state: "done",
    startedAt: at("2026-10-01"),
    doneAt: at("2026-10-02"),
  });
  const untouched = task({
    id: "0199c4d8-0000-7000-8000-000000000054",
    number: 24,
    title: "Not begun",
  });
  const all = [taken, waiting, finished, untouched];

  it("is on a project's month on the days it was worked: a dot on one day, a bar across several, never late", () => {
    // The week of today, begun on a Monday: the 5th through the 11th.
    const week = weekOf(TODAY, 1).map((day) => ({ day, inMonth: true }));
    expect(
      weekSegments(week, all, TODAY).map((segment) => [
        segment.task.number,
        segment.from,
        segment.to,
        segment.begins,
        segment.ends,
      ]),
    ).toEqual([[22, 2, 4, true, true]]);
    expect(n(tasksOn("2026-10-09", all, TODAY))).toEqual([22]);
    // It waits for its review since, which is no day it was worked.
    expect(n(tasksOn(TODAY, all, TODAY))).toEqual([21]);
    expect(n(tasksOn("2026-10-02", all, TODAY))).toEqual([23]);
    // Through today and no further: the plan is not written, and tomorrow is nobody's yet.
    expect(tasksOn("2026-10-12", all, TODAY)).toEqual([]);
    const html = renderToStaticMarkup(
      <Calendar
        tasks={all}
        month="2026-10"
        today={TODAY}
        weekStart="monday"
        taskHref={href}
        monthHref={(month) => month}
      />,
    );
    expect(html).toMatch(/class="sc-calendar-task"[^>]*>[\s\S]{0,400}?Taken at once/);
    expect(html.match(/sc-calendar-dot/g)).toHaveLength(1);
    expect(html).toContain("sc-calendar-bar sc-category-blue sc-calendar-bar-begins");
    expect(html).toContain("Worked for days");
    // What is done reads as what was, on the days it was worked.
    expect(html).toMatch(
      /class="sc-calendar-bar[^"]*sc-calendar-over"[^>]*>[\s\S]{0,400}?Finished/,
    );
    expect(html).not.toContain("Not begun");
    // No due day, so none is late; and the month is not empty.
    expect(html).not.toContain("sc-calendar-late");
    expect(html).not.toContain("Nothing is due this month");
    // The month after holds none of them: nothing is laid past today.
    const after = renderToStaticMarkup(
      <Calendar
        tasks={all}
        month="2026-12"
        today={TODAY}
        weekStart="monday"
        taskHref={href}
        monthHref={(month) => month}
      />,
    );
    expect(after).toContain("Nothing is due this month");
  });

  it("is on the week of a plate the same way, a person's and an agent account's, and still among what has no day set", () => {
    const closed = task({
      id: "0199c4d8-0000-7000-8000-000000000055",
      number: 25,
      title: "Finished today",
      state: "done",
      startedAt: at(TODAY, 9),
      doneAt: at(TODAY, 11),
    });
    const html = renderToStaticMarkup(
      <WorkList
        work={{
          tasks: [taken, waiting, untouched].map((one) => ({ project: web, task: one })),
          closed: [{ project: web, task: closed }],
        }}
        today={TODAY}
        weekStart="monday"
        taskHref={(key, item) => `/projects/${key}/tasks/${item.number}`}
        decisionHref={() => "#"}
        weekHref={(day) => `/work?week=${day}`}
      />,
    );
    const week = html.slice(0, html.indexOf("sc-work-lists"));
    expect(week).toMatch(/class="sc-calendar-task"[^>]*>[\s\S]{0,400}?Taken at once/);
    expect(week).toContain("sc-calendar-bar sc-category-blue sc-calendar-bar-begins");
    expect(week).toContain("Worked for days");
    expect(week).toMatch(
      /class="sc-calendar-task[^"]*sc-calendar-over[^"]*"[^>]*>[\s\S]{0,400}?Finished today/,
    );
    expect(week).not.toContain("Not begun");
    expect(week).not.toContain("Nothing is planned this week.");
    // The plan is as it was: all three open tasks have no day set, and the list says so.
    const lists = html.slice(html.indexOf("sc-work-lists"));
    expect(lists).toContain('aria-label="No day set"');
    for (const title of ["Taken at once", "Worked for days", "Not begun"]) {
      expect(lists).toContain(title);
    }
    expect(lists).not.toContain("Finished today");
    // The week before today's holds what was worked then, and not what was begun since.
    const before = renderToStaticMarkup(
      <Week
        tasks={[...all, closed]}
        day="2026-10-02"
        today={TODAY}
        weekStart="monday"
        taskHref={href}
        weekHref={(day) => day}
      />,
    );
    expect(before).toContain("Finished last week");
    expect(before).not.toContain("Taken at once");
    expect(before).not.toContain("Worked for days");
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
      plugin: null,
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
      packToken: null,
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

  it("carries a mark after it where the member is an agent account, and none for a person", () => {
    const account: RestPerson = { ...bob, name: "Mira", kind: "agent", handle: "mira" };
    const chip = renderToStaticMarkup(<PersonChip person={account} />);
    // After the name, with what the letters stand for on hover.
    expect(chip).toMatch(
      />Mira<\/span><span class="sc-kind-mark" title="Agent account">AI<\/span><\/span>$/,
    );
    expect(renderToStaticMarkup(<PersonChip person={alice} />)).not.toContain("sc-kind-mark");
    expect(
      renderToStaticMarkup(<PersonChip person={{ ...alice, kind: "person" }} />),
    ).not.toContain("sc-kind-mark");
    // Among others to choose from, beside the name and not under it.
    const option = renderToStaticMarkup(<PersonOption person={account} />);
    expect(option).toMatch(
      /<span class="sc-person-option-name"><span class="sc-person-login">Mira<\/span><span class="sc-kind-mark"/,
    );
    expect(renderToStaticMarkup(<PersonOption person={alice} />)).not.toContain("sc-kind-mark");
    expect(renderToStaticMarkup(<KindMark person={account} />)).toContain(">AI<");
    expect(renderToStaticMarkup(<KindMark person={{}} />)).toBe("");
    // Pictures alone: the names on hover say which of them is one.
    expect(renderToStaticMarkup(<Workers workers={[alice, account]} />)).toContain(
      'title="Alice Example, Mira (AI)"',
    );
  });
});

describe("a chip", () => {
  it("names a thing among others, with the way to take it out only where it can be", () => {
    const read = renderToStaticMarkup(<Chip>Platform</Chip>);
    expect(read).toBe('<span class="sc-chip"><span class="sc-chip-label">Platform</span></span>');
    const kept = renderToStaticMarkup(
      <Chip onRemove={() => undefined} removeLabel="Take bob out of Platform" className="sc-team">
        <PersonChip person={bob} />
      </Chip>,
    );
    expect(kept).toContain('class="sc-chip sc-team"');
    expect(kept).toContain(
      '<button type="button" class="sc-chip-remove" aria-label="Take bob out of Platform" title="Take bob out of Platform">',
    );
    expect(kept).toContain('<span aria-hidden="true">×</span>');
    // Left unnamed, the way out says what it does.
    expect(renderToStaticMarkup(<Chip onRemove={() => undefined}>x</Chip>)).toContain(
      'aria-label="Remove"',
    );
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
    // Each picture is a thumbnail that opens large over the page, in the text and after it; nothing leaves the page.
    expect(html.split('class="sc-picture-thumb"').length).toBe(3);
    expect(html).toContain('aria-label="Open the picture shot &lt;2&gt;.webp"');
    expect(html).not.toContain('target="_blank"');
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
      decider: alice,
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

  it("show the console's rules as they hold, what the organization adds below them, and a project that adds none (ADR-0120)", () => {
    const own = "# Rules for agents <b>here</b>\n\nRead first.";
    // Nothing added: the console's rules, read and not edited, and the way to add to them.
    const alone = renderToStaticMarkup(
      <RulesView
        rules={{ source: "reference", body: own, page: null, own, added: null }}
        scope="workspace"
        editHref="/settings?rules"
        onArchive={() => undefined}
      />,
    );
    expect(alone).toContain("The console&#x27;s rules always hold");
    expect(alone).toContain("Rules for agents &lt;b&gt;here&lt;/b&gt;");
    expect(alone).not.toContain("<b>here</b>");
    expect(alone).toContain("What this organization adds");
    expect(alone).toContain("This organization adds nothing to them yet.");
    expect(alone).toContain("Add to the rules");
    // Nothing to put away while nothing is added, and nothing puts the console's rules back.
    expect(alone).not.toContain(">Remove<");
    expect(alone).not.toContain("Reset to the console");
    // Something added: both, apart, the addition with its facts and the ways to change it.
    const added = renderToStaticMarkup(
      <RulesView
        rules={{
          source: "written",
          body: `${own}\n\n# What this organization adds\n\nAsk first.`,
          page,
          own,
          added: { body: "Ask first.", page },
        }}
        scope="workspace"
        editHref="/settings?rules"
        onArchive={() => undefined}
      />,
    );
    expect(added).toContain("Read first.");
    expect(added).toContain("v2");
    expect(added).toContain("bob");
    expect(added).toContain("as Claude Code");
    expect(added).toContain(">Edit<");
    expect(added).toContain(">Remove<");
    expect(added).toContain('class="sc-rules-actions"');
    // Each part once: the whole is not shown beside its parts.
    expect(added.split("Ask first.")).toHaveLength(2);
    expect(added.split("Read first.")).toHaveLength(2);
    // Folded under where it comes from, on a project's page: the whole, and {language} filled
    // with the language the pages speak.
    const folded = renderToStaticMarkup(
      <RulesView
        rules={{
          source: "written",
          body: "Write in {language}.\n\n# What this organization adds\n\nAsk first.",
          page,
          own: "Write in {language}.",
          added: { body: "Ask first.", page },
        }}
        scope="workspace"
        folded
      />,
    );
    expect(folded).toContain('<details class="sc-rules-fold"><summary>Read the rules</summary>');
    expect(folded).toContain("Write in English.");
    expect(folded).toContain("Ask first.");
    expect(folded).not.toContain("{language}");
    // A console of before answers the whole and no parts: read as it is, and not changed from here.
    const before = renderToStaticMarkup(
      <RulesView
        rules={{ source: "written", body: "Ask first.", page }}
        scope="workspace"
        editHref="/settings?rules"
        onArchive={() => undefined}
      />,
    );
    expect(before).toContain("Ask first.");
    expect(before).not.toContain("sc-button");
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

  it("write what the organization adds on a form that is empty until something is added, and save nothing that would change nothing", () => {
    // The console's rules are read above the form, never in it.
    const empty = renderToStaticMarkup(
      <RulesForm
        rules={{ source: "reference", body: "# Theirs", page: null, own: "# Theirs", added: null }}
        scope="workspace"
        template=""
        onSubmit={() => undefined}
      />,
    );
    expect(empty).toContain("<summary>Read the console&#x27;s rules</summary>");
    expect(empty).toMatch(/<textarea[^>]*><\/textarea>/);
    expect(empty).toContain("What this organization adds");
    expect(empty).toContain("disabled");
    // Something added: the form starts from it, and from nothing of the console's.
    const adding = renderToStaticMarkup(
      <RulesForm
        rules={{
          source: "written",
          body: "# Theirs\n\n# What this organization adds\n\nAsk first.",
          page,
          own: "# Theirs",
          added: { body: "Ask first.", page },
        }}
        scope="workspace"
        template=""
        onSubmit={() => undefined}
      />,
    );
    expect(adding).toMatch(/<textarea[^>]*>Ask first\.<\/textarea>/);
    expect(adding).not.toContain("Reset to the console");
    // A project that adds none starts from the five things it may say.
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
    expect(fresh).not.toContain("Read the console");
  });
});

describe("the roadmap as months (ADR-0026)", () => {
  const planned = goal({
    startsOn: "2026-10-01",
    dueOn: "2026-12-31",
    category: { key: "engineering", name: "Engineering", color: "blue" },
  });
  const ids = (n: number) => `0199c4d8-0000-7000-8000-0000000000${n}`;

  it("lays the goals across the months from their start to their target, cut to the span", () => {
    const bars = timelineBars(
      [
        planned,
        goal({ id: ids(31), startsOn: "2026-08-01", dueOn: "2026-10-15" }),
        goal({ id: ids(32), startsOn: null, dueOn: "2026-11-15" }),
        goal({ id: ids(33), startsOn: null, dueOn: null }),
        goal({ id: ids(34), startsOn: "2027-05-01", dueOn: "2027-06-01" }),
      ],
      "2026-10",
      6,
    );
    // The span: October 2026 to March 2027, 182 days.
    expect(bars.map((bar) => bar.goal.id)).toEqual([planned.id, ids(31), ids(32)]);
    expect(bars[0]).toMatchObject({ from: 0, begins: true, ends: true, point: false });
    expect(bars[0]?.to).toBeCloseTo(92 / 182);
    expect(bars[1]).toMatchObject({ from: 0, begins: false, ends: true, point: false });
    expect(bars[1]?.to).toBeCloseTo(15 / 182);
    expect(bars[2]).toMatchObject({ begins: true, ends: true, point: true });
    expect(bars[2]?.from).toBeCloseTo(45 / 182);
    expect(timelineBars([planned], "2026-10", 0)).toEqual([]);
  });

  it("shows the months, each goal as a bar in its colour with its progress, today, the legend and the goals without days", () => {
    const html = renderToStaticMarkup(
      <GoalTimeline
        goals={[planned, goal({ id: ids(33), title: "Someday", startsOn: null, dueOn: null })]}
        from="2026-10"
        today={TODAY}
        categories={[engineering]}
        goalHref={(item) => `/projects/web/roadmap/${item.id}`}
        fromHref={(month) => `/projects/web/roadmap?from=${month}`}
      />,
    );
    expect(html).toContain("sc-timeline-month");
    expect(html).toContain("sc-timeline-bar");
    expect(html).toContain("sc-category-blue");
    expect(html).toContain("sc-timeline-fill");
    expect(html).toContain("2/4");
    expect(html).toContain("sc-timeline-today");
    expect(html).toContain("Someday");
    expect(html).toContain("No day set");
    expect(html).toContain("Engineering");
    expect(html).toContain('href="/projects/web/roadmap?from=2026-09"');
    expect(html).toContain('href="/projects/web/roadmap?from=2026-11"');
    expect(html).toContain(`href="/projects/web/roadmap/${planned.id}"`);
    // The label keeps to one line beside its bar, so a long title is cut short and said in full on
    // hover, as text: what was typed never becomes markup there either.
    expect(html).toContain(
      `<a class="sc-timeline-goal" href="/projects/web/roadmap/${planned.id}" title="Ship v1 &lt;b&gt;now&lt;/b&gt;">`,
    );
    const empty = renderToStaticMarkup(
      <GoalTimeline
        goals={[]}
        from="2026-10"
        today={TODAY}
        goalHref={() => "#"}
        fromHref={() => "#"}
      />,
    );
    expect(empty).toContain("No goal is planned in these months.");
  });

  it("shows a day's first tasks and the way to the rest, so that a busy week stays as tall as the others", () => {
    const due = (n: number) =>
      task({
        id: `0199c4d8-0000-7000-8000-0000000004${String(n).padStart(2, "0")}`,
        number: 40 + n,
        title: `Due ${n}`,
        dueOn: "2026-11-12",
        openDecisions: 0,
      });
    const html = renderToStaticMarkup(
      <Calendar
        tasks={[1, 2, 3, 4, 5, 6].map(due)}
        month="2026-11"
        today={TODAY}
        taskHref={href}
        monthHref={() => "#"}
      />,
    );
    expect(html.split('sc-calendar-task-title">Due ').length - 1).toBe(3);
    expect(html).toContain('class="sc-calendar-more" aria-expanded="false">3 more</button>');
    // One more than the day shows is shown whole: a button would take the room of the task.
    const four = renderToStaticMarkup(
      <Calendar
        tasks={[1, 2, 3, 4].map(due)}
        month="2026-11"
        today={TODAY}
        taskHref={href}
        monthHref={() => "#"}
      />,
    );
    expect(four.split('sc-calendar-task-title">Due ').length - 1).toBe(4);
    expect(four).not.toContain("sc-calendar-more");
  });

  it("marks the target day of a goal on the calendar when told where its page is", () => {
    const html = renderToStaticMarkup(
      <Calendar
        tasks={[]}
        month="2026-11"
        today={TODAY}
        goals={[
          goal(),
          goal({ id: ids(31), title: "Let go", state: "dropped", dueOn: "2026-11-20" }),
        ]}
        taskHref={href}
        goalHref={(item) => `/projects/web/roadmap/${item.id}`}
        monthHref={(month) => `/projects/web/calendar?month=${month}`}
      />,
    );
    expect(html).toContain("sc-calendar-goal");
    expect(html).toContain(`href="/projects/web/roadmap/${goal().id}"`);
    expect(html).toContain("Ship v1 &lt;b&gt;now&lt;/b&gt;");
    expect(html).not.toContain("Let go");
    const unmarked = renderToStaticMarkup(
      <Calendar
        tasks={[]}
        month="2026-11"
        today={TODAY}
        goals={[goal()]}
        taskHref={href}
        monthHref={(month) => `/projects/web/calendar?month=${month}`}
      />,
    );
    expect(unmarked).not.toContain("sc-calendar-goal");
  });

  it("keeps a goal's row in every day of its week, so that a bar lies level under the goals", () => {
    // A goal on a Sunday and a task across that week: the bar's pieces on the other days would
    // lie a row higher than the first, and the title running along it would cross what is there.
    const html = renderToStaticMarkup(
      <Calendar
        tasks={[task({ startsOn: "2026-11-15", dueOn: "2026-11-18", title: "Across" })]}
        month="2026-11"
        today={TODAY}
        goals={[goal(), goal({ id: ids(32), title: "Second", dueOn: "2026-11-15" })]}
        taskHref={href}
        goalHref={(item) => `/projects/web/roadmap/${item.id}`}
        monthHref={(month) => `/projects/web/calendar?month=${month}`}
        weekStart="sunday"
      />,
    );
    // Two goals on the 15th: the six other days of that week keep two rows each, and no other week any.
    expect(html.match(/sc-calendar-goal sc-calendar-goal-held/g)).toHaveLength(12);
    const weeks = html.split("<tr>").filter((row) => row.includes("sc-calendar-cell"));
    const held = weeks.filter((row) => row.includes("sc-calendar-goal-held"));
    expect(held).toHaveLength(1);
    expect(held[0]).toContain("Across");
    // In every day of that week the bar comes after the rows for goals, real or kept.
    for (const cell of (held[0] ?? "").split("<td").slice(1, 5)) {
      expect(cell.indexOf("sc-calendar-bar")).toBeGreaterThan(cell.lastIndexOf("sc-calendar-goal"));
    }
    // A kept row is nothing to read or to follow.
    expect(html).toMatch(
      /<span class="sc-calendar-goal sc-calendar-goal-held" aria-hidden="true">/,
    );
  });

  it("takes the category and the start day on the form, and shows them on the list and the goal", () => {
    const form = renderToStaticMarkup(
      <GoalForm categories={[engineering]} onSubmit={() => undefined} />,
    );
    expect(form).toContain("No category");
    expect(form).toContain("Engineering");
    expect(form).toContain("Start day");
    expect(form.split('type="date"')).toHaveLength(3);
    const edit = renderToStaticMarkup(
      <GoalForm goal={planned} categories={[engineering]} onSubmit={() => undefined} />,
    );
    expect(edit).toContain('value="2026-10-01"');
    const list = renderToStaticMarkup(
      <GoalList goals={[planned]} goalHref={() => "#"} today={TODAY} />,
    );
    expect(list).toContain("sc-badge-category");
    expect(list).toContain("sc-goal-days");
    const view = renderToStaticMarkup(
      <GoalView goal={planned} tasks={[]} taskHref={href} today={TODAY} />,
    );
    expect(view).toContain("Starts");
    expect(view).toContain("Engineering");
    const bare = renderToStaticMarkup(
      <GoalView goal={goal({ dueOn: null })} tasks={[]} taskHref={href} today={TODAY} />,
    );
    expect(bare).toContain("No start day");
    expect(bare).toContain("No category");
  });
});

describe("a picture large over the page", () => {
  const picture = {
    src: "/api/v1/projects/web/files/f1",
    alt: "the board",
    name: "board.png",
    size: 2048,
  };

  const stage = { width: 1400, height: 800 };

  it("opens with all of it in view, and a long one at the stage's width from its top", () => {
    // Smaller than the stage: at its own size, in the middle.
    expect(openingView({ width: 600, height: 400 }, stage)).toEqual({ scale: 1, x: 0, y: 0 });
    expect(wholeScale({ width: 600, height: 400 }, stage)).toBe(1);
    // Larger, and of a shape near the stage's: all of it, smaller than its own size.
    const large = { width: 2800, height: 2000 };
    expect(wholeScale(large, stage)).toBeCloseTo(0.4);
    expect(openingView(large, stage)).toEqual({ scale: 0.4, x: 0, y: 0 });
    // A page captured from top to bottom: whole it would be a strip, so it opens as wide as the
    // stage has room for, never over its own size, with its top at the stage's top.
    const long = { width: 1440, height: 6000 };
    expect(wholeScale(long, stage)).toBeCloseTo(800 / 6000);
    const opened = openingView(long, stage);
    expect(opened.scale).toBeCloseTo(1400 / 1440);
    expect(opened.x).toBe(0);
    expect(opened.y).toBeCloseTo((6000 * opened.scale - 800) / 2);
    // A narrow one, a phone's screen captured: at its own size, from its top.
    expect(openingView({ width: 780, height: 5044 }, stage)).toEqual({
      scale: 1,
      x: 0,
      y: (5044 - 800) / 2,
    });
    // A wide one: as tall as the stage has room for, from its left.
    const wide = openingView({ width: 9000, height: 800 }, stage);
    expect(wide).toEqual({ scale: 1, x: (9000 - 1400) / 2, y: 0 });
    // Nothing measured yet, or nothing sensible: its own size, and no number that is none.
    expect(openingView({ width: 0, height: 0 }, stage)).toEqual({ scale: 1, x: 0, y: 0 });
    expect(openingView(long, { width: Number.NaN, height: 800 })).toEqual({ scale: 1, x: 0, y: 0 });
    expect(wholeScale({ width: -5, height: 10 }, stage)).toBe(1);
  });

  it("zooms out until all of it is in view and in to eight times its own size, around a point", () => {
    const long = { width: 1440, height: 6000 };
    const opened = openingView(long, stage);
    // Out, a step at a time, and no further than the whole: then it stands in the middle.
    let view = opened;
    for (let step = 0; step < 40; step += 1) {
      view = zoomAround(view, 1 / 1.25, { x: 0, y: 0 }, long, stage);
    }
    expect(view.scale).toBeCloseTo(800 / 6000);
    expect(view.x).toBe(0);
    expect(view.y).toBe(0);
    expect(zoomAround(view, 0.5, { x: 0, y: 0 }, long, stage)).toBe(view);
    // In, around a point: what was under the pointer stays under it.
    const small = { width: 600, height: 400 };
    const start = { scale: 1, x: 0, y: 0 };
    const zoomed = zoomAround(start, 4, { x: 100, y: 50 }, small, stage);
    expect(zoomed.scale).toBe(4);
    expect((100 - zoomed.x) / zoomed.scale).toBeCloseTo(100);
    expect((50 - zoomed.y) / zoomed.scale).toBeCloseTo(50);
    expect(zoomAround(zoomed, 100, { x: 0, y: 0 }, small, stage).scale).toBe(8);
    expect(wheelFactor(-100)).toBeCloseTo(1.25);
    expect(wheelFactor(100)).toBeCloseTo(0.8);
    expect(wheelFactor(0)).toBe(1);
    expect(wheelFactor(Number.NaN)).toBe(1);
  });

  it("moves as far as there is more of it that way, and stands in the middle where there is none", () => {
    const long = { width: 1440, height: 6000 };
    const opened = openingView(long, stage);
    // Down the page: the picture goes up, until its foot is at the stage's.
    const lower = panBy(opened, 0, -500, long, stage);
    expect(lower.y).toBeCloseTo(opened.y - 500);
    const foot = panBy(opened, 0, -100000, long, stage);
    expect(foot.y).toBeCloseTo(-opened.y);
    // No further up than its top, and not sideways: it is no wider than the stage.
    expect(panBy(opened, 300, 300, long, stage)).toEqual(opened);
    // A view from elsewhere is held to what there is to see.
    expect(boundView({ scale: 99, x: 1e9, y: Number.NaN }, long, stage)).toEqual({
      scale: 8,
      x: (1440 * 8 - 1400) / 2,
      y: 0,
    });
    expect(boundView({ scale: Number.NaN, x: 0, y: 0 }, long, stage).scale).toBeCloseTo(800 / 6000);
    // All of it in view: a drag moves nothing.
    const whole = { scale: wholeScale(long, stage), x: 0, y: 0 };
    expect(panBy(whole, 50, 50, long, stage)).toEqual(whole);
  });

  it("is a thumbnail that opens it, and a dialog that names it with the ways to zoom and to close", () => {
    const thumb = renderToStaticMarkup(<PictureThumb picture={picture} onOpen={() => undefined} />);
    expect(thumb).toContain(
      '<button type="button" class="sc-picture-thumb" aria-label="Open the picture board.png">',
    );
    expect(thumb).toContain(
      '<img src="/api/v1/projects/web/files/f1" alt="the board" loading="lazy" decoding="async"',
    );
    const overlay = renderToStaticMarkup(
      <PictureOverlay picture={picture} onClose={() => undefined} />,
    );
    expect(overlay).toContain('role="dialog"');
    expect(overlay).toContain('aria-modal="true"');
    expect(overlay).toContain('aria-label="The picture board.png, large"');
    for (const label of ["Zoom in", "Zoom out", "Fit to the screen", "Close"]) {
      expect(overlay).toContain(`aria-label="${label}"`);
    }
    expect(overlay).toContain('href="/api/v1/projects/web/files/f1" target="_blank"');
    expect(overlay).toContain("2.0 KB");
    // Until the picture has said how large it is, the stylesheet holds it within the stage.
    expect(overlay).toContain('class="sc-overlay-picture sc-overlay-picture-unsized"');
    expect(overlay).not.toContain("style=");
    const korean = renderToStaticMarkup(
      <LanguageContext.Provider value={KOREAN}>
        <PictureThumb picture={picture} onOpen={() => undefined} />
      </LanguageContext.Provider>,
    );
    expect(korean).toContain('aria-label="그림 board.png 크게 보기"');
  });
});

describe("a goal in its views", () => {
  const planned: RestGoal = {
    id: "0199c4d8-0000-7000-8000-000000000400",
    title: "Ship the board",
    body: "",
    state: "active",
    category: null,
    startsOn: "2026-10-01",
    dueOn: "2026-11-15",
    createdBy: alice,
    taskCounts: { idea: 1, ready: 0, in_progress: 1, in_review: 0, done: 2, dropped: 0 },
    createdAt: "2026-10-01T09:00:00.000Z",
    updatedAt: "2026-10-01T09:00:00.000Z",
  };
  const href = (task: RestTask) => `/projects/web/tasks/${task.number}`;

  it("opens the calendar on this month while the goal is under way, else on its start or its target", () => {
    expect(goalMonth(planned, "2026-10-14")).toBe("2026-10");
    expect(goalMonth(planned, "2026-09-20")).toBe("2026-10");
    expect(goalMonth(planned, "2026-12-02")).toBe("2026-11");
    expect(goalMonth({ ...planned, startsOn: null, dueOn: null }, "2026-12-02")).toBe("2026-12");
    expect(goalMonth({ ...planned, startsOn: null }, "2026-12-02")).toBe("2026-11");
  });

  it("shows the view the address names, with the switch between them and the progress at the head", () => {
    const board = renderToStaticMarkup(
      <GoalView
        goal={planned}
        tasks={[]}
        taskHref={href}
        today="2026-10-14"
        view="board"
        viewHref={(view) => `/projects/web/roadmap/g?view=${view}`}
        board={<div id="the-board" />}
        calendar={<div id="the-calendar" />}
      />,
    );
    expect(board).toContain('id="the-board"');
    expect(board).not.toContain('id="the-calendar"');
    expect(board).toContain("2 of 4 tasks done");
    expect(board).toContain(
      '<a class="sc-view sc-view-current" href="/projects/web/roadmap/g?view=board" aria-current="page">Board</a>',
    );
    expect(board).toContain('href="/projects/web/roadmap/g?view=calendar"');
    const calendar = renderToStaticMarkup(
      <GoalView
        goal={planned}
        tasks={[]}
        taskHref={href}
        today="2026-10-14"
        view="calendar"
        board={<div id="the-board" />}
        calendar={<div id="the-calendar" />}
      />,
    );
    expect(calendar).toContain('id="the-calendar"');
    expect(calendar).not.toContain("sc-views");
    // Without a board given, the board view falls back to the list, as a console of before shows it.
    const list = renderToStaticMarkup(
      <GoalView goal={planned} tasks={[]} taskHref={href} today="2026-10-14" view="board" />,
    );
    expect(list).toContain("No task works towards it yet.");
  });
});

describe("a card dragged to another column", () => {
  it("is movable only where the board can move a task, by itself and not by a grip or a select, in columns that say which state they stand for", () => {
    const tasks = [
      { ...task({ state: "idea" }), id: "0199c4d8-0000-7000-8000-000000000501", number: 51 },
    ];
    const movable = renderToStaticMarkup(
      <Board
        tasks={tasks}
        taskHref={() => "#"}
        onOpen={() => undefined}
        onMove={() => undefined}
      />,
    );
    expect(movable).toContain('data-column="idea"');
    expect(movable).toContain('data-column="dropped"');
    expect(movable).toContain('class="sc-board sc-board-movable"');
    expect(movable).toContain('class="sc-card sc-card-movable"');
    expect(movable).not.toContain("sc-card-grip");
    expect(movable).not.toContain("<select");
    const readOnly = renderToStaticMarkup(
      <Board tasks={tasks} taskHref={() => "#"} onOpen={() => undefined} />,
    );
    expect(readOnly).not.toContain("sc-card-movable");
    expect(readOnly).not.toContain("sc-board-movable");
    expect(readOnly).not.toContain("sc-drag-ghost");
    expect(columnStateOf("in_review")).toBe("in_review");
    expect(columnStateOf("archived")).toBeUndefined();
    expect(columnStateOf(undefined)).toBeUndefined();
  });

  it("carries the board on while the pointer is near an edge, the nearer the faster, and not elsewhere", () => {
    const frame = 16;
    // Away from both edges, nothing; within the edge, towards it.
    expect(edgeScrollOf(500, 0, 1000, frame)).toBe(0);
    expect(edgeScrollOf(48, 0, 1000, frame)).toBe(0);
    expect(edgeScrollOf(47, 0, 1000, frame)).toBeLessThan(0);
    expect(edgeScrollOf(953, 0, 1000, frame)).toBeGreaterThan(0);
    // At the edge itself, the full speed for the frame: 720 pixels a second; halfway in, half.
    expect(edgeScrollOf(1000, 0, 1000, frame)).toBeCloseTo(11.52);
    expect(edgeScrollOf(976, 0, 1000, frame)).toBeCloseTo(5.76);
    expect(edgeScrollOf(0, 0, 1000, frame)).toBeCloseTo(-11.52);
    // Beyond the edge, outside the board, no faster than at it; a longer frame carries further,
    // but a frame counts for 64 milliseconds at most, and one that runs backwards for nothing.
    expect(edgeScrollOf(-300, 0, 1000, frame)).toBeCloseTo(-11.52);
    expect(edgeScrollOf(1000, 0, 1000, 2 * frame)).toBeCloseTo(23.04);
    expect(edgeScrollOf(1000, 0, 1000, 5000)).toBeCloseTo(edgeScrollOf(1000, 0, 1000, 64));
    expect(edgeScrollOf(1000, 0, 1000, -frame)).toBe(0);
    // A board narrower than two edges scrolls towards the nearer one.
    expect(edgeScrollOf(10, 0, 60, frame)).toBeLessThan(0);
    expect(edgeScrollOf(50, 0, 60, frame)).toBeGreaterThan(0);
  });

  it("has a menu with the way to the form and the way to put the task away, whatever the state", () => {
    const render = (
      overrides: Partial<RestTask>,
      ways: {
        editHref?: (task: RestTask) => string;
        onArchive?: (task: RestTask) => void;
      },
    ) =>
      renderToStaticMarkup(
        <Board
          tasks={[task(overrides)]}
          taskHref={href}
          onOpen={() => undefined}
          folded={[]}
          {...ways}
        />,
      );
    const button = 'aria-label="Task menu" aria-haspopup="menu" aria-expanded="false"';
    const open = render(
      { state: "in_progress" },
      { editHref: (target) => `/projects/web/tasks/${target.number}?edit` },
    );
    expect(open).toContain(button);
    // The menu is closed as rendered: nothing of what it holds is on the page yet.
    expect(open).not.toContain('role="menu"');
    const done = render({ state: "done" }, { onArchive: () => undefined });
    expect(done).toContain(button);
    // The way to put away alone gives a menu to any task, open or not (ADR-0030).
    const openWithoutForm = render({ state: "in_progress" }, { onArchive: () => undefined });
    expect(openWithoutForm).toContain(button);
    expect(render({}, {})).not.toContain("sc-card-menu-button");
    const korean = renderToStaticMarkup(
      <LanguageContext.Provider value={KOREAN}>
        <Board tasks={[task()]} taskHref={href} onOpen={() => undefined} editHref={() => "#"} />
      </LanguageContext.Provider>,
    );
    expect(korean).toContain('aria-label="작업 메뉴"');
  });
});

describe("the pack token of a project", () => {
  it("is given on a form that shows nothing of it, with the way to take it away once set", () => {
    const empty = renderToStaticMarkup(<PackTokenForm set={false} onSubmit={() => undefined} />);
    expect(empty).toContain('type="password"');
    expect(empty).toContain('autoComplete="off"');
    expect(empty).toContain("Set the token");
    expect(empty).not.toContain("Remove the token");
    const set = renderToStaticMarkup(
      <PackTokenForm
        set
        setAt="2026-10-09T10:00:00.000Z"
        onSubmit={() => undefined}
        onRemove={() => undefined}
      />,
    );
    expect(set).toContain("Remove the token");
    expect(set).toContain("Replace the token");
    expect(set).toContain("A token has been set since");
    expect(set).not.toContain("Set the token");
    const korean = renderToStaticMarkup(
      <LanguageContext.Provider value={KOREAN}>
        <PackTokenForm set={false} onSubmit={() => undefined} />
      </LanguageContext.Provider>,
    );
    expect(korean).toContain("토큰 넣기");
  });

  it("offers to connect with a code first, and says what the person will do", () => {
    const html = renderToStaticMarkup(
      <PackConnect
        onStart={() => Promise.reject(new Error("not asked"))}
        poll={() => Promise.resolve({ status: "none" } as const)}
        claim={() => Promise.reject(new Error("not claimed"))}
        onCancel={() => Promise.resolve()}
      />,
    );
    expect(html).toContain("Connect at SkillCDN");
    expect(html).toContain("The console asks SkillCDN for a code.");
    expect(html).not.toContain("Stop waiting");
  });
});

describe("the archive of the board (ADR-0029)", () => {
  it("offers to put a task away and to bring one back, and says on the task that it is put away", () => {
    const render = (
      overrides: Partial<RestTask>,
      handlers: { onArchive?: () => void; onRestore?: () => void } = {},
    ) =>
      renderToStaticMarkup(
        <TaskView
          task={task(overrides)}
          people={[alice, bob]}
          tasks={[]}
          decisions={[]}
          taskHref={href}
          formHref={(wanted) => `/projects/web/tasks/7?${wanted}`}
          onCancel={() => undefined}
          onChange={() => undefined}
          onMove={() => undefined}
          onRaiseDecision={() => undefined}
          onAnswer={() => undefined}
          {...handlers}
        />,
      );
    const both = { onArchive: () => undefined, onRestore: () => undefined };
    // Any task not put away is put away, open or not (ADR-0030); only one put away is brought back.
    const open = render({ state: "in_progress" }, both);
    expect(open).toContain(">Put away</button>");
    expect(open).not.toContain(">Bring back</button>");
    const done = render({ state: "done", doneAt: "2026-10-10T10:00:00.000Z" }, both);
    expect(done).toContain(">Put away</button>");
    expect(done).not.toContain(">Bring back</button>");
    expect(done).not.toContain('sc-badge sc-badge-neutral">Put away<');
    const archived = render(
      {
        state: "dropped",
        archivedAt: "2026-10-12T10:00:00.000Z",
      },
      both,
    );
    expect(archived).toContain('class="sc-badge sc-badge-neutral">Put away</span>');
    expect(archived).toContain("<dt>Put away</dt>");
    expect(archived).toContain(">Bring back</button>");
    expect(archived).not.toContain(">Put away</button>");
    const readOnly = render({ state: "done", archivedAt: "2026-10-12T10:00:00.000Z" });
    expect(readOnly).not.toContain(">Bring back</button>");
    expect(readOnly).not.toContain(">Put away</button>");
  });

  it("puts the done tasks of a goal away from the goal's page, where the page offers it", () => {
    const offered = renderToStaticMarkup(
      <GoalView
        goal={goal()}
        tasks={[]}
        taskHref={href}
        today={TODAY}
        onArchiveTasks={() => undefined}
      />,
    );
    expect(offered).toContain(">Put the done tasks away</button>");
    const plain = renderToStaticMarkup(
      <GoalView goal={goal()} tasks={[]} taskHref={href} today={TODAY} />,
    );
    expect(plain).not.toContain("Put the done tasks away");
  });

  it("says in the feed what was put away and what was brought back", () => {
    const event: RestEvent = {
      id: 11,
      kind: "task.archived",
      actor: alice,
      agent: null,
      projectId: null,
      taskId: "0199c4d8-0000-7000-8000-000000000010",
      decisionId: null,
      runId: null,
      documentId: null,
      goalId: null,
      plugin: null,
      data: { number: 7, title: "Ship" },
      createdAt: "2026-10-09T10:00:00.000Z",
    };
    expect(describeEvent(event)).toBe("put #7 Ship away");
    expect(describeEvent({ ...event, kind: "task.restored" })).toBe("brought #7 Ship back");
    // What the console did itself names nobody.
    const own = renderToStaticMarkup(<EventFeed events={[{ ...event, actor: null }]} />);
    expect(own).toContain("put #7 Ship away");
  });
});

describe("the workspace's settings", () => {
  const workspace = {
    name: "Acme",
    tokenDaysAtMost: null,
    skills: { source: "https://skillcdn.ai", address: "/gh/acme/skills" },
    peopleVisibility: "everyone",
    weekStart: "auto",
    timeZone: null,
  } as const;
  const at = new Date("2026-01-15T00:00:00Z");

  it("groups the zones by area, the ones with none first, each with its offset", () => {
    const groups = timeZoneGroups(["Europe/Paris", "Asia/Tokyo", "UTC", "Asia/Seoul"], at, [
      "America/New_York",
      undefined,
      "",
    ]);
    expect(groups.map((group) => group.area)).toEqual(["", "America", "Asia", "Europe"]);
    expect(groups[0]?.zones).toEqual([{ name: "UTC", offset: "UTC+00:00" }]);
    expect(groups[1]?.zones).toEqual([{ name: "America/New_York", offset: "UTC-05:00" }]);
    expect(groups[2]?.zones).toEqual([
      { name: "Asia/Seoul", offset: "UTC+09:00" },
      { name: "Asia/Tokyo", offset: "UTC+09:00" },
    ]);
    expect(offsetOf("Nowhere/Nothing", at)).toBeUndefined();
  });

  it("shows the services its agents work with, and what an agent is called at each (ADR-0089)", () => {
    const bare = renderToStaticMarkup(<WorkspaceServicesView workspace={workspace} />);
    expect(bare.match(/Not set/g)).toHaveLength(5);
    const named = {
      ...workspace,
      handle: "acme",
      domain: "acme.example",
      services: {
        identity: { kind: "google-workspace" },
        git: { kind: "github", organization: "acme" },
        messenger: { kind: "matrix", server: "<b>chat</b>.acme.example" },
      },
    };
    const html = renderToStaticMarkup(<WorkspaceServicesView workspace={named} />);
    expect(html).toContain("<dt>Short name</dt><dd>acme</dd>");
    expect(html).toContain("<dt>Domain</dt><dd>acme.example</dd>");
    expect(html).toContain("Google Workspace");
    expect(html).toContain("An agent called mira is mira@acme.example there.");
    expect(html).toContain("GitHub");
    expect(html).toContain("organization: acme");
    expect(html).toContain("An agent called mira is acme-mira there.");
    // A kind the console does not know is named as it came, as text.
    expect(html).toContain("matrix");
    expect(html).toContain("&lt;b&gt;chat&lt;/b&gt;.acme.example");

    const form = renderToStaticMarkup(
      <WorkspaceServicesForm workspace={named} onSubmit={() => undefined} />,
    );
    expect(form).toContain('value="acme"');
    expect(form).toContain(
      '<option value="google-workspace" selected="">Google Workspace</option>',
    );
    // Each role offers the kinds it may have, none, and another.
    expect(form.match(/<option value="github"/g)).toHaveLength(2);
    expect(form.match(/<option value="slack"/g)).toHaveLength(1);
    expect(form.match(/<option value="\*"/g)).toHaveLength(3);
    expect(form).toContain('placeholder="{workspace}-{agent}"');
    // The kind it does not know is shown as another, by its name.
    expect(form).toContain('<option value="*" selected="">Another</option>');
    expect(form).toContain('value="matrix"');
    // Nothing changed yet: nothing to save.
    expect(/<button[^>]*type="submit"[^>]*>/.exec(form)?.[0]).toContain('disabled=""');
    // A GitLab is a git host and nothing else, named with its group, its host and the form of
    // account an agent has there: a person's, or the host's own for a machine.
    expect(form.match(/<option value="gitlab"/g)).toHaveLength(1);
    const atGitLab = {
      ...named,
      services: {
        git: { kind: "gitlab", group: "acme/platform", host: "git.acme.example", form: "service" },
      },
    };
    const gitlab = renderToStaticMarkup(
      <WorkspaceServicesForm workspace={atGitLab} onSubmit={() => undefined} />,
    );
    expect(gitlab).toContain('<option value="gitlab" selected="">GitLab</option>');
    expect(gitlab).toContain(">Group</span>");
    expect(gitlab).toContain('value="acme/platform"');
    expect(gitlab).toContain(">Host, where it is not gitlab.com</span>");
    expect(gitlab).toContain(
      '<option value="service" selected="">A service account, the host&#x27;s own for a machine</option>',
    );
    expect(renderToStaticMarkup(<WorkspaceServicesView workspace={atGitLab} />)).toContain(
      "An agent called mira is acme-mira there.",
    );
    const korean = renderToStaticMarkup(
      <LanguageContext.Provider value={KOREAN}>
        <WorkspaceServicesView workspace={named} />
      </LanguageContext.Provider>,
    );
    expect(korean).not.toContain("Short name");
    expect(korean).toContain("mira@acme.example");
    // What a value of a kind the console knows is called is the page's word, and a form of
    // account is said as what it is; another kind's values stand under the names they came with.
    expect(korean).toContain("조직: acme");
    expect(korean).not.toContain("organization: acme");
    expect(korean).toContain("server: &lt;b&gt;chat&lt;/b&gt;.acme.example");
    expect(renderToStaticMarkup(<WorkspaceServicesView workspace={atGitLab} />)).toContain(
      "form of account: a service account",
    );
    expect(
      renderToStaticMarkup(
        <LanguageContext.Provider value={KOREAN}>
          <WorkspaceServicesView workspace={atGitLab} />
        </LanguageContext.Provider>,
      ),
    ).toContain("계정 형태: 서비스 계정");
  });

  it("says why the services form will not save, under what is wrong", () => {
    const wrong = {
      ...workspace,
      handle: "Acme Corp",
      domain: "acme",
      services: {
        git: { kind: "github", organization: "not a name" },
        messenger: { kind: "github" },
      },
    };
    const form = renderToStaticMarkup(
      <WorkspaceServicesForm workspace={wrong} onSubmit={() => undefined} />,
    );
    expect(form).toContain(
      '<span class="sc-form-error" role="alert">A short name is small letters, digits and hyphens, with a letter or a digit first and last.</span>',
    );
    expect(form).toContain("Not a domain: write it as acme.example.");
    // A value is named by its label on the form, and a kind that may not have a role by the role.
    expect(form).toContain("Organization: not written as this service takes it.");
    expect(form).toContain("This service cannot be named for Messenger.");
    expect(form.match(/aria-invalid="true"/g)).toHaveLength(2);
    // What an agent would be called there is not said of a service that will not be kept.
    expect(form).not.toContain("An agent called mira is");
    const korean = renderToStaticMarkup(
      <LanguageContext.Provider value={KOREAN}>
        <WorkspaceServicesForm workspace={wrong} onSubmit={() => undefined} />
      </LanguageContext.Provider>,
    );
    expect(korean).toContain("도메인 형식이 아닙니다. acme.example처럼 적어 주세요.");
    expect(korean).toContain("조직: 이 서비스가 받는 형식이 아닙니다.");
    expect(korean).toContain("이 서비스는 메신저 용도로 쓸 수 없습니다.");
    // A form with nothing wrong says none of it.
    const fine = renderToStaticMarkup(
      <WorkspaceServicesForm
        workspace={{ ...workspace, handle: "acme", domain: "acme.example" }}
        onSubmit={() => undefined}
      />,
    );
    expect(fine).not.toContain("sc-form-error");
    expect(fine).not.toContain('aria-invalid="true"');
  });

  it("shows the settings as rows, the zone with its offset and the device's beside it", () => {
    const html = renderToStaticMarkup(<WorkspaceSettingsView workspace={workspace} />);
    expect(html).toContain("sc-settings-item");
    expect(html).toContain("Everyone of the workspace");
    expect(html).toContain("System default");
    expect(html).toContain("<dd>None");
    // The language for whoever has none (ADR-0081): none set, English then; or the one set, by its own name.
    expect(html).toContain("<dt>Default language</dt><dd>Not set: English</dd>");
    expect(
      renderToStaticMarkup(<WorkspaceSettingsView workspace={{ ...workspace, language: "ko" }} />),
    ).toContain("<dt>Default language</dt><dd>한국어</dd>");
    const seoul = renderToStaticMarkup(
      <WorkspaceSettingsView workspace={{ ...workspace, timeZone: "Asia/Seoul" }} />,
    );
    expect(seoul).toContain("Asia/Seoul");
    expect(seoul).toContain("(UTC+09:00)");
    const device = deviceTimeZone();
    if (device !== undefined && device !== "Asia/Seoul") {
      expect(seoul).toContain(`This device: ${device}`);
    }
  });

  it("names the console's version first, with the commands it takes, where the page knows it", () => {
    const html = renderToStaticMarkup(
      <WorkspaceSettingsView
        workspace={workspace}
        console={{ version: "0.4.1", clientRange: ">=0.4.1 <0.5.0" }}
      />,
    );
    expect(html.indexOf("Console version")).toBeLessThan(html.indexOf("Member visibility"));
    expect(html).toContain('<dd>0.4.1<span class="sc-settings-note">');
    expect(html).toContain("Takes the console command &gt;=0.4.1 &lt;0.5.0");
    const unknown = renderToStaticMarkup(<WorkspaceSettingsView workspace={workspace} />);
    expect(unknown).not.toContain("Console version");
  });

  it("offers each setting beside its words, the zones in a picker, and saves only what changed", () => {
    const html = renderToStaticMarkup(
      <WorkspaceSettingsForm workspace={workspace} onSubmit={() => undefined} />,
    );
    expect(html).toContain("sc-settings-row");
    expect(html).toContain('<option value="monday">Monday</option>');
    expect(html).toContain('<option value="auto" selected="">System default</option>');
    expect(html).toContain('<option value="" selected="">None</option>');
    expect(html).toContain('<option value="UTC">UTC (UTC+00:00)</option>');
    expect(html).toContain('<optgroup label="Asia">');
    expect(html).toContain("Asia/Seoul (UTC+09:00)");
    if (deviceTimeZone() !== undefined) {
      expect(html).toContain("Use this device");
    }
    // The languages the console speaks, each by its own name, and none.
    expect(html).toContain('<option value="" selected="">Not set: English</option>');
    expect(html).toContain('<option value="ko" lang="ko">한국어</option>');
    // Nothing changed yet: nothing to save.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save the settings<\/button>/);
  });
});

describe("the workers of a task, and what a form finds by searching (ADR-0037)", () => {
  const carol: RestPerson = {
    ...bob,
    id: "0199c4d8-0000-7000-8000-000000000003",
    login: "carol",
    name: "Carol",
  };
  const dave: RestPerson = {
    ...bob,
    id: "0199c4d8-0000-7000-8000-000000000004",
    login: "dave",
    name: null,
  };
  const nothing = async () => ({ items: [], more: false });
  const view = (item: RestTask) =>
    renderToStaticMarkup(
      <TaskView
        task={item}
        people={[alice, bob]}
        tasks={[]}
        decisions={[]}
        taskHref={href}
        onChange={() => undefined}
        onMove={() => undefined}
        onRaiseDecision={() => undefined}
        onAnswer={() => undefined}
      />,
    );

  it("shows the workers as pictures side by side with a count of the rest, and names them on the task", () => {
    const crew = renderToStaticMarkup(<Workers workers={[alice, bob, carol, dave]} />);
    expect(crew.match(/class="sc-avatar/g)).toHaveLength(3);
    expect(crew).toContain("+1");
    expect(crew).toContain('title="Alice Example, bob, Carol, dave"');
    expect(renderToStaticMarkup(<Workers workers={[]} />)).toBe("");
    const crewed = view(task({ workers: [alice, carol] }));
    expect(crewed).toContain("<dt>Workers</dt>");
    expect(crewed).toContain("Alice Example");
    expect(crewed).toContain("Carol");
    expect(view(task({ workers: [] }))).toContain("Nobody");
  });

  it("counts a task for each of its workers in who has what", () => {
    const rows = workloadOf(
      [
        task({ workers: [alice, bob] }),
        task({ id: "0199c4d8-0000-7000-8000-000000000011", workers: [] }),
      ],
      TODAY,
    );
    expect(rows.map((row) => [row.person?.login ?? null, row.open])).toEqual([
      ["alice", 1],
      ["bob", 1],
      [null, 1],
    ]);
  });

  it("offers the workers as chips with a way to add one, and finds the parent and the goal by searching", () => {
    const parent = task({ id: "0199c4d8-0000-7000-8000-000000000012", number: 1, title: "Launch" });
    const html = renderToStaticMarkup(
      <TaskForm
        people={[alice, bob, carol]}
        task={task({ workers: [bob], parentId: parent.id })}
        parent={parent}
        findTasks={nothing}
        findGoals={nothing}
        onSubmit={() => undefined}
      />,
    );
    // Bob is a chip; Alice and Carol are who can be added.
    expect(html).toContain('aria-label="Remove: bob"');
    expect(html).not.toContain('aria-label="Remove: Alice Example"');
    expect(html).toMatch(/<input[^>]*aria-label="Add a worker"/);
    // The state and the priority, short and fixed, stay lists.
    expect(html.match(/<select/g)).toHaveLength(2);
    // The parent stands in the field's place; the goal, none yet, is searched for.
    expect(html).toContain("sc-picker-chosen");
    expect(html).toContain("Launch");
    expect(html).toContain('placeholder="Search by title"');
    expect(html).not.toContain('placeholder="Search by number or title"');
    // A parent the page has not read back yet is held, not dropped.
    const held = renderToStaticMarkup(
      <TaskForm
        people={[]}
        task={task({ parentId: parent.id })}
        findTasks={nothing}
        onSubmit={() => undefined}
      />,
    );
    expect(held).toContain("sc-picker-chosen");
    expect(held).toContain("\u2026");
    // Without a search given, neither field is offered; a new task starts with nobody on it.
    const bare = renderToStaticMarkup(<TaskForm people={[alice]} onSubmit={() => undefined} />);
    // The one combobox left is the worker's, searched for (ADR-0037).
    expect(bare.match(/role="combobox"/g)).toHaveLength(1);
    expect(bare).not.toContain("Part of");
    // Nobody is on it yet: the way to add one, a chip at the end of the row, stands alone.
    expect(bare).toMatch(/class="sc-picker sc-picker-add"><input[^>]*aria-label="Add a worker"/);
    expect(bare).not.toContain("Nobody");
    // Where nobody can be added, the row says nobody is on it.
    expect(renderToStaticMarkup(<TaskForm people={[]} onSubmit={() => undefined} />)).toContain(
      "Nobody",
    );
  });

  it("opens its list below the field, and above it only where the window has no room below and more above", () => {
    const field = { top: 600, bottom: 640 };
    // Room below: below.
    expect(opensAbove(field, 200, 900)).toBe(false);
    // No room below, more above: above.
    expect(opensAbove(field, 300, 900)).toBe(true);
    // No room either way, and more below than above: below, as a list does.
    expect(opensAbove({ top: 100, bottom: 140 }, 300, 400)).toBe(false);
  });

  it("is a combobox that searches a page at a time, and a chip once something is chosen", () => {
    const picker = (value: RestTask | undefined) =>
      renderToStaticMarkup(
        <Picker
          value={value}
          search={nothing}
          keyOf={(item) => item.id}
          render={(item) => <span>#{item.number}</span>}
          label="Part of"
          placeholder="Search"
          onChange={() => undefined}
        />,
      );
    const empty = picker(undefined);
    expect(empty).toContain('role="combobox"');
    expect(empty).toContain('aria-expanded="false"');
    expect(empty).toContain('placeholder="Search"');
    expect(empty).not.toContain('role="listbox"');
    const chosen = picker(task({ number: 42 }));
    expect(chosen).toContain("#42");
    expect(chosen).toContain('aria-label="Remove"');
    expect(chosen).not.toContain('role="combobox"');
  });
});

describe("raising a decision about a task found by search (ADR-0037)", () => {
  const nothing = async () => ({ items: [], more: false });
  it("searches for the task when none is given, and asks nothing when the page's task is the one", () => {
    const searching = renderToStaticMarkup(
      <DecisionForm findTasks={nothing} onSubmit={() => undefined} />,
    );
    expect(searching).toContain("About");
    expect(searching).toContain('role="combobox"');
    expect(searching).toContain('placeholder="No task in particular"');
    const fromTask = renderToStaticMarkup(
      <DecisionForm taskId={task().id} findTasks={nothing} onSubmit={() => undefined} />,
    );
    expect(fromTask).not.toContain('role="combobox"');
    expect(fromTask).not.toContain("About");
    const bare = renderToStaticMarkup(<DecisionForm onSubmit={() => undefined} />);
    expect(bare).not.toContain('role="combobox"');
    expect(bare).toContain("Raise the decision");
  });
});
