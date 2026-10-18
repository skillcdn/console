import {
  type ComponentType,
  type ReactNode,
  StrictMode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  ApiError,
  type ConsoleClient,
  createClient,
  type FileUpload,
  OPEN_TASK_STATES,
  PROJECT_RULES_TEMPLATE,
  REFERENCE_RULES,
  type RestAnswerInput,
  type RestComment,
  type RestDecision,
  type RestDecisionInput,
  type RestDecisionPatch,
  type RestEvent,
  type RestProject,
  type RestProjectInput,
  type RestProjectPatch,
  type RestProjectRules,
  type RestRules,
  type RestTask,
  type RestTaskInput,
  type RestToken,
  type RestTokenCreated,
  type RestWork,
  RULES_PATH,
  RULES_TITLE,
  type TaskState,
  type WeekStart,
} from "./api.js";
import { Board, BoardFilters, type BoardProps, byDue, filterTasks } from "./components/board.js";
import { Calendar, type CalendarProps, Workload } from "./components/calendar.js";
import { CategoryList, type CategoryListProps } from "./components/categories.js";
import { ConnectWords } from "./components/connect.js";
import { DecisionForm } from "./components/decision-form.js";
import { DecisionCard, DecisionList, type DecisionListProps } from "./components/decision-list.js";
import { EventFeed, type EventFeedProps } from "./components/event-feed.js";
import { GoalForm, GoalList, type GoalListProps, GoalView, goalMonth } from "./components/goals.js";
import { PackTokenWays } from "./components/pack-token.js";
import { PAGE_SIZE } from "./components/paged.js";
import { ListingForm, PeopleList, type PeopleListProps } from "./components/people.js";
import {
  MemberList,
  type MemberListProps,
  ProjectForm,
  ProjectList,
  type ProjectListProps,
  ProjectMark,
} from "./components/projects.js";
import { GoalTimeline } from "./components/roadmap.js";
import { RulesForm, RulesView } from "./components/rules.js";
import {
  type Brand,
  isPlainClick,
  type NavItem,
  Shell,
  type ShellProps,
} from "./components/shell.js";
import { SignIn, type SignInProps } from "./components/sign-in.js";
import { SkillList, type SkillListProps } from "./components/skills.js";
import { TaskForm } from "./components/task-form.js";
import { TaskList } from "./components/task-list.js";
import { TaskView, type TaskViewProps } from "./components/task-view.js";
import { NewToken, TokenForm, TokenList, type TokenListProps } from "./components/tokens.js";
import {
  Button,
  Callout,
  CategoryBadge,
  EmptyState,
  personName,
  Spinner,
  StateBadge,
  Time,
} from "./components/ui.js";
import { WorkList, type WorkListProps } from "./components/work.js";
import {
  peopleVisibilityOf,
  WorkspaceSettingsForm,
  WorkspaceSettingsView,
  weekStartOf,
} from "./components/workspace.js";
import { ConnectPage } from "./connect-page.js";
import { type ConsoleData, useConsoleData } from "./data.js";
import { monthOf, today } from "./dates.js";
import { DocsPage } from "./docs-page.js";
import {
  chooseLanguage,
  DEFAULT_LANGUAGES,
  LanguageContext,
  type LanguagePack,
  type Messages,
  useWords,
} from "./i18n/index.js";
import {
  boardHref,
  calendarHref,
  customPageHref,
  decisionHref,
  decisionsHref,
  docHref,
  type GoalTaskView,
  goalHref,
  matchRoute,
  type Navigation,
  newDecisionHref,
  newGoalHref,
  newTaskHref,
  PATHS,
  personAgentsHref,
  personWorkHref,
  projectHref,
  projectSettingsHref,
  type Route,
  roadmapHref,
  settingsHref,
  signInFailureOf,
  taskHref,
  withoutSignInParam,
  workHref,
} from "./router.js";
import { projectPath } from "./routes.js";
import { errorWords, useAction } from "./use-action.js";

// The composition of the default console: the pages assembled from the components, with the
// places a team may replace named. The UI the image serves is this, with the default config.
// The front page is the projects; a project's pages are under its key, every form has an
// address, and the history is one entry per step (ADR-0010). The pages speak the person's
// language, from the packs the console is given (ADR-0012).

/** The components a custom console may replace, each with the props the default one takes. */
export interface ConsoleComponents {
  readonly Shell: ComponentType<ShellProps>;
  readonly Board: ComponentType<BoardProps>;
  readonly TaskView: ComponentType<TaskViewProps>;
  readonly DecisionList: ComponentType<DecisionListProps>;
  readonly EventFeed: ComponentType<EventFeedProps>;
  readonly SignIn: ComponentType<SignInProps>;
  readonly TokenList: ComponentType<TokenListProps>;
  readonly PeopleList: ComponentType<PeopleListProps>;
  readonly SkillList: ComponentType<SkillListProps>;
  readonly ProjectList: ComponentType<ProjectListProps>;
  readonly MemberList: ComponentType<MemberListProps>;
  readonly Calendar: ComponentType<CalendarProps>;
  readonly GoalList: ComponentType<GoalListProps>;
  readonly WorkList: ComponentType<WorkListProps>;
  readonly CategoryList: ComponentType<CategoryListProps>;
}

export const DEFAULT_COMPONENTS: ConsoleComponents = {
  Shell,
  Board,
  TaskView,
  DecisionList,
  EventFeed,
  SignIn,
  TokenList,
  PeopleList,
  SkillList,
  ProjectList,
  MemberList,
  Calendar,
  GoalList,
  WorkList,
  CategoryList,
};

/**
 * A page a console adds of its own, shown as a tab beside the console's: on the workspace, or
 * on every project. The address is `/pages/<key>`, or `/projects/<project>/pages/<key>`.
 */
export interface CustomPage {
  /** What the address says, and what tells the page apart: lowercase letters, digits and hyphens. */
  readonly key: string;
  /** What the tab says: one word for every language, or a word by language tag, `en` standing in for a tag without one. */
  readonly label: string | Readonly<Record<string, string>>;
  /** Where the tab is: among the workspace's pages, or among each project's. */
  readonly level: "workspace" | "project";
  /** Whether the page takes the whole width of the window, as the board does. */
  readonly wide?: boolean | undefined;
  /** What the page shows, given what the default pages are given. */
  readonly render: (context: CustomPageContext) => ReactNode;
}

/** What a page of a console's own is given: the data the default pages read, and the means they use. */
export interface CustomPageContext {
  /** The workspace and, on a project, the project the page is on, kept current; with the actions. */
  readonly data: ConsoleData;
  /** The project the page is on, or nothing on the workspace. */
  readonly project: RestProject | undefined;
  /** The client, for what the data does not carry. */
  readonly client: ConsoleClient;
  readonly navigation: Navigation;
  /** The words of the language the pages speak, and its tag. */
  readonly words: Messages;
  readonly language: string;
}

/** What the tab of a page of one's own says in a language: its word for the tag, for the language alone, for English, or the first it has. */
export function customPageLabel(page: CustomPage, tag: string): string {
  if (typeof page.label === "string") {
    return page.label;
  }
  const language = tag.split("-")[0] ?? tag;
  return (
    page.label[tag] ??
    page.label[language] ??
    page.label.en ??
    Object.values(page.label)[0] ??
    page.key
  );
}

export interface ConsoleConfig {
  /** The origin of the console's API. Left out, the page's own origin. */
  readonly baseUrl?: string | undefined;
  /** What the board is called before the server says; the server's name wins once it answers. */
  readonly title?: string | undefined;
  /** The components to use in place of the default ones. */
  readonly components?: Partial<ConsoleComponents> | undefined;
  /** The languages the pages speak, the first being the one spoken when nothing else decides; the package's when left out. */
  readonly languages?: readonly LanguagePack[] | undefined;
  /** The marks beside the name (ADR-0013); none shows the name alone. A custom console brings its own. */
  readonly brand?: Brand | undefined;
  /** The client to talk to the server with; made from `baseUrl` when left out. For tests. */
  readonly client?: ConsoleClient | undefined;
  /** Pages of the console's own, as tabs beside the default ones. */
  readonly pages?: readonly CustomPage[] | undefined;
}

export interface ConsoleApp {
  /** The whole console as one component, for a custom page to place. */
  readonly App: ComponentType<{ readonly initialPath?: string | undefined }>;
  /** Renders the console into `container`. Returns the way to take it down again. */
  mount(container: Element): () => void;
}

/** How many steps back from a history entry stay within the app: kept on the entry itself. */
function depthOf(state: unknown): number {
  return typeof state === "object" &&
    state !== null &&
    "scDepth" in state &&
    typeof state.scDepth === "number"
    ? state.scDepth
    : 0;
}

/**
 * The browser's location as the app reads it, and the ways to move: one history entry per step
 * the person takes, none for the same address again, a replacement for a redirect or for what a
 * form made, and back to where a form was opened from when that is within the app.
 */
function useNavigation(initialPath: string | undefined) {
  const read = useCallback(
    () =>
      typeof window === "undefined"
        ? { pathname: initialPath ?? "/", search: "" }
        : { pathname: window.location.pathname, search: window.location.search },
    [initialPath],
  );
  const [location, setLocation] = useState(read);
  useEffect(() => {
    const update = () => setLocation(read());
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, [read]);
  const navigation = useMemo<Navigation>(() => {
    const show = (href: string, replace: boolean) => {
      if (typeof window === "undefined") {
        return;
      }
      const { pathname, search, hash } = window.location;
      if (href === `${pathname}${search}${hash}`) {
        return;
      }
      const depth = depthOf(window.history.state);
      if (replace) {
        window.history.replaceState({ scDepth: depth }, "", href);
      } else {
        window.history.pushState({ scDepth: depth + 1 }, "", href);
        window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      }
      setLocation(read());
    };
    return {
      go: (href) => show(href, false),
      replace: (href) => show(href, true),
      back: (fallback) => {
        if (typeof window !== "undefined" && depthOf(window.history.state) > 0) {
          window.history.back();
        } else {
          show(fallback, true);
        }
      },
    };
  }, [read]);
  return { location, navigation };
}

/**
 * Every plain click on a link to one of the console's own addresses is followed in place, from
 * here, wherever the link is: in a document, in a feed line, in a task. A modified click, a link
 * elsewhere, a file of the API, a sign-in, and a jump within the page stay the browser's.
 */
function useFollowLinks(navigation: Navigation): void {
  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || !isPlainClick(event)) {
        return;
      }
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }
      if ((anchor.target !== "" && anchor.target !== "_self") || anchor.hasAttribute("download")) {
        return;
      }
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) {
        return;
      }
      const { pathname, search } = window.location;
      if (url.pathname === pathname && url.search === search && url.hash !== "") {
        return;
      }
      if (matchRoute(url.pathname, url.search).name === "not-found") {
        return;
      }
      event.preventDefault();
      navigation.go(`${url.pathname}${url.search}${url.hash}`);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [navigation]);
}

/** The key of the project a route is on, or nothing. */
const projectOf = (route: Route): string | undefined =>
  "project" in route ? route.project : undefined;

/** The field the pages lie on, for a page without the shell: signing in, and the wait before it. */
function Ground(props: { readonly children: React.ReactNode }) {
  return (
    <div className="sc-shell">
      <main className="sc-main">{props.children}</main>
    </div>
  );
}

/**
 * Whether the console holds a token rather than a session: a person's own console, served from
 * their machine with the token the command keeps (ADR-0014). The API says so with `me.agent`.
 */
function holdsToken(data: ConsoleData): boolean {
  return data.me !== undefined && data.me.agent !== null;
}

/**
 * The pages a console that holds a token does not offer: the tokens themselves, and the
 * approval of an agent's connection, which makes one; a person's own doing on the console's
 * own pages, signed in. Everything else a person may do, their agent may (ADR-0021).
 */
export function onlyOnOwnPages(route: Route): boolean {
  return (
    route.name === "agents" ||
    route.name === "new-token" ||
    route.name === "person-agents" ||
    route.name === "connect"
  );
}

function NotWithToken() {
  const words = useWords().common.notWithToken;
  return <EmptyState title={words.title} body={words.body} />;
}

/** A link that reads as a button: where a form is, for instance. */
function LinkButton(props: {
  readonly href: string;
  readonly variant?: "primary" | "secondary";
  readonly children: React.ReactNode;
}) {
  return (
    <a className={`sc-button sc-button-${props.variant ?? "secondary"}`} href={props.href}>
      {props.children}
    </a>
  );
}

function ProjectsPage(props: {
  readonly data: ConsoleData;
  readonly components: ConsoleComponents;
  readonly navigation: Navigation;
  /** Whether the form for a new project is open: the page is at its address. */
  readonly making: boolean;
}) {
  const words = useWords().projects;
  const { data, components, navigation, making } = props;
  const { busy, error, act } = useAction();
  const href = (project: RestProject) => projectHref(project.key);
  return (
    <>
      <div className="sc-page-head">
        <h1 className="sc-page-title">{words.title}</h1>
        {!making && (
          <LinkButton href={PATHS.newProject} variant="primary">
            {words.newProject}
          </LinkButton>
        )}
      </div>
      {error !== undefined && <Callout tone="danger">{error}</Callout>}
      {making && (
        <section className="sc-panel sc-panel-form" aria-label={words.form.aria}>
          <ProjectForm
            busy={busy}
            skillsSource={data.me?.workspace.skills.source}
            organizationAddress={data.me?.workspace.skills.address ?? null}
            onSubmit={(input, icon) =>
              void act(async () => {
                const made = await data.actions.createProject(
                  input as RestProjectInput,
                  icon instanceof File ? uploadOf(icon) : undefined,
                );
                navigation.replace(projectHref(made.key));
              })
            }
            onCancel={() => navigation.back(PATHS.projects)}
          />
        </section>
      )}
      <components.ProjectList
        projects={data.projects}
        projectHref={href}
        onOpen={(project) => navigation.go(href(project))}
        empty={
          <EmptyState
            title={words.empty.title}
            body={words.empty.body}
            action={<LinkButton href={PATHS.newProject}>{words.newProject}</LinkButton>}
          />
        }
      />
    </>
  );
}

/**
 * The archive of the board (ADR-0029): the tasks put away, newest first, a page at a time from
 * the server, each brought back from here by whoever may work in the project.
 */
function ArchivePage(props: { readonly project: RestProject; readonly data: ConsoleData }) {
  const words = useWords();
  const { project, data } = props;
  const key = project.key;
  const { busy, error, act } = useAction();
  const [items, setItems] = useState<readonly RestTask[]>([]);
  const [more, setMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const { archivedTasks } = data.actions;
  const feedLength = data.events.length;
  // The first page, read again whenever the project's feed grows: something was put away or brought back.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the feed's length is what triggers the read
  useEffect(() => {
    const controller = new AbortController();
    archivedTasks({ limit: PAGE_SIZE, offset: 0 }, controller.signal)
      .then((page) => {
        if (!controller.signal.aborted) {
          setItems(page.items);
          setMore(page.more);
          setLoaded(true);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [archivedTasks, feedLength]);
  const onMore = () =>
    void archivedTasks({ limit: PAGE_SIZE, offset: items.length })
      .then((page) => {
        setItems((current) => [...current, ...page.items]);
        setMore(page.more);
      })
      .catch(() => undefined);
  const archive = words.archive;
  return (
    <>
      <div className="sc-page-head">
        <h1 className="sc-page-title">{archive.title}</h1>
        <LinkButton href={projectHref(key)}>{words.nav.board}</LinkButton>
      </div>
      {error !== undefined && <Callout tone="danger">{error}</Callout>}
      {!loaded ? (
        <Spinner label={archive.loading} />
      ) : items.length === 0 ? (
        <EmptyState title={archive.empty.title} body={archive.empty.body} />
      ) : (
        <>
          <ul className="sc-task-rows" aria-label={archive.title}>
            {items.map((task) => (
              <li key={task.id} className="sc-task-row">
                <a className="sc-task-row-title" href={taskHref(key, task.number)}>
                  <span className="sc-card-number">#{task.number}</span> {task.title}
                </a>
                <span className="sc-task-row-meta">
                  <StateBadge state={task.state} />
                  {task.archivedAt !== null && (
                    <span className="sc-muted">
                      {archive.since} <Time iso={task.archivedAt} />
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await data.actions.restoreTask(task.id);
                        setItems((current) =>
                          current.filter((candidate) => candidate.id !== task.id),
                        );
                      })
                    }
                  >
                    {archive.restore}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
          {more && (
            <div className="sc-show-more">
              <Button variant="secondary" size="sm" onClick={onMore}>
                {archive.more}
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}

function TaskPage(props: {
  readonly route: Extract<Route, { name: "task" }>;
  readonly project: RestProject;
  readonly data: ConsoleData;
  readonly components: ConsoleComponents;
  readonly navigation: Navigation;
  readonly busy: boolean;
  readonly error: string | undefined;
  readonly act: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const words = useWords();
  const { route, project, data, components, navigation, busy, error, act } = props;
  const key = project.key;
  const current =
    route.number === undefined
      ? data.tasks.find((candidate) => candidate.id === route.id)
      : data.tasks.find((candidate) => candidate.number === route.number);
  // A task put away is not among the board's (ADR-0029): it is asked for by itself.
  const [fetched, setFetched] = useState<RestTask | undefined>(undefined);
  const [missing, setMissing] = useState<string | undefined>(undefined);
  const { fetchTask } = data.actions;
  const wanted =
    current === undefined && data.projectLoaded
      ? route.number === undefined
        ? route.id
        : String(route.number)
      : undefined;
  useEffect(() => {
    if (wanted === undefined) {
      return;
    }
    const controller = new AbortController();
    fetchTask(wanted, controller.signal)
      .then((found) => {
        if (!controller.signal.aborted) {
          setFetched(found);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setMissing(wanted);
        }
      });
    return () => controller.abort();
  }, [wanted, fetchTask]);
  const task =
    current ??
    (fetched !== undefined && (fetched.id === route.id || fetched.number === route.number)
      ? fetched
      : undefined);
  const [history, setHistory] = useState<readonly RestEvent[] | undefined>(undefined);
  const [comments, setComments] = useState<readonly RestComment[] | undefined>(undefined);
  const { taskHistory, taskComments } = data.actions;
  const taskId = task?.id;
  const number = task?.number;
  // A task named by its id is shown at its number's address.
  useEffect(() => {
    if (route.id !== undefined && number !== undefined) {
      navigation.replace(taskHref(key, number, route.form));
    }
  }, [route.id, route.form, number, key, navigation]);
  // Everything that happened to the task, asked for again whenever the project's feed grows.
  const feedLength = data.events.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the feed's length is the trigger
  useEffect(() => {
    if (taskId === undefined) {
      return;
    }
    const controller = new AbortController();
    taskHistory(taskId, controller.signal)
      .then((events) => {
        if (!controller.signal.aborted) {
          setHistory(events);
        }
      })
      .catch(() => undefined);
    taskComments(taskId, controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) {
          setComments(items);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [taskId, taskHistory, taskComments, feedLength]);
  if (task === undefined) {
    if (wanted !== undefined && missing !== wanted) {
      return <Spinner label={words.common.loading} />;
    }
    return (
      <EmptyState
        title={words.task.noSuch.title}
        body={words.task.noSuch.body}
        action={<LinkButton href={projectHref(key)}>{words.nav.board}</LinkButton>}
      />
    );
  }
  const here = taskHref(key, task.number);
  return (
    <components.TaskView
      task={task}
      people={data.people.filter(inWorkspace)}
      tasks={data.tasks}
      decisions={data.decisions}
      runs={data.runs}
      comments={comments}
      history={history}
      categories={data.categories}
      goals={data.goals}
      taskHref={(candidate) => taskHref(key, candidate.number)}
      decisionHref={(decisionId) => decisionHref(key, decisionId)}
      goalHref={(goalId) => goalHref(key, goalId)}
      fileHref={(fileId) => projectPath(key, "files", fileId)}
      docHref={(path) => docHref(key, path)}
      form={route.form}
      formHref={(form) => taskHref(key, task.number, form)}
      onCancel={() => navigation.back(here)}
      busy={busy}
      error={error}
      onChange={(target, patch) =>
        void act(async () => {
          await data.actions.updateTask(target.id, patch);
          navigation.replace(here);
        })
      }
      onMove={(target, state) => void act(() => data.actions.updateTask(target.id, { state }))}
      onRaiseDecision={(input) =>
        void act(async () => {
          await data.actions.raiseDecision(input);
          navigation.replace(here);
        })
      }
      onAnswer={(decision, input) =>
        void act(() => data.actions.answerDecision(decision.id, input))
      }
      onUpdateDecision={(decision, patch) =>
        void act(() => data.actions.updateDecision(decision.id, patch))
      }
      onAbandonRun={(run) => void act(() => data.actions.abandonRun(run.id))}
      onArchive={(target) =>
        void act(async () => {
          await data.actions.archiveTask(target.id);
          navigation.go(projectHref(key, "archive"));
        })
      }
      onRestore={(target) =>
        void act(async () => {
          setFetched(await data.actions.restoreTask(target.id));
        })
      }
      onComment={(draft) =>
        void act(async () => {
          await data.actions.comment(task.id, {
            body: draft.body,
            files: draft.files.map((file) => ({
              name: file.name,
              bytes: file,
              ...(file.type === "" ? {} : { contentType: file.type }),
            })),
          });
          setComments(await taskComments(task.id));
        })
      }
    />
  );
}

function ProjectPage(props: {
  readonly route: Route;
  readonly project: RestProject;
  readonly data: ConsoleData;
  readonly components: ConsoleComponents;
  readonly navigation: Navigation;
}) {
  const words = useWords();
  const { route, project, data, components, navigation } = props;
  const { busy, error, act } = useAction();
  const tasksById = useMemo(() => new Map(data.tasks.map((task) => [task.id, task])), [data.tasks]);
  const key = project.key;
  const href = (task: RestTask) => taskHref(key, task.number);
  const toDoc = (path: string) => docHref(key, path);
  const owner = project.role === "owner";

  const onMove = (task: RestTask, state: TaskState) =>
    void act(() => data.actions.updateTask(task.id, { state }));
  const onAnswer = (decision: RestDecision, input: RestAnswerInput) =>
    void act(() => data.actions.answerDecision(decision.id, input));
  const onUpdate = (decision: RestDecision, patch: RestDecisionPatch) =>
    void act(() => data.actions.updateDecision(decision.id, patch));

  if (route.name === "board") {
    const me = data.me?.person ?? undefined;
    const shown = filterTasks(data.tasks, route.filter, me);
    return (
      <>
        <div className="sc-page-head">
          <div className="sc-page-heading">
            <h1 className="sc-page-title">{project.name}</h1>
            {project.description.length > 0 && (
              <p className="sc-page-lead" title={project.description}>
                {project.description}
              </p>
            )}
          </div>
          <div className="sc-page-actions">
            <LinkButton href={projectHref(key, "archive")}>{words.board.archive}</LinkButton>
            <LinkButton href={newTaskHref(key)} variant="primary">
              {words.board.writeTask}
            </LinkButton>
          </div>
        </div>
        {error !== undefined && <Callout tone="danger">{error}</Callout>}
        {data.tasks.length > 0 && (
          <BoardFilters
            filter={route.filter}
            categories={data.categories}
            goals={data.goals}
            people={data.people.filter(inWorkspace)}
            me={me}
            shown={shown.length}
            total={data.tasks.length}
            onChange={(filter) => navigation.replace(boardHref(key, filter))}
          />
        )}
        <components.Board
          tasks={shown}
          taskHref={href}
          onOpen={(task) => navigation.go(href(task))}
          onMove={onMove}
          editHref={(task) => taskHref(key, task.number, "edit")}
          onEdit={(task) => navigation.go(taskHref(key, task.number, "edit"))}
          onArchive={(task) => void act(() => data.actions.archiveTask(task.id))}
          empty={
            data.tasks.length === 0 ? (
              <EmptyState
                title={words.board.empty.title}
                body={words.board.empty.body}
                action={<LinkButton href={newTaskHref(key)}>{words.board.writeTask}</LinkButton>}
              />
            ) : undefined
          }
        />
      </>
    );
  }
  if (route.name === "new-task") {
    return (
      <>
        <div className="sc-page-head">
          <h1 className="sc-page-title">{words.task.newTitle}</h1>
        </div>
        {error !== undefined && <Callout tone="danger">{error}</Callout>}
        <section className="sc-panel sc-panel-form" aria-label={words.task.newAria}>
          <TaskForm
            people={data.people.filter(inWorkspace)}
            parents={data.tasks}
            categories={data.categories}
            goals={data.goals}
            busy={busy}
            onSubmit={(input: RestTaskInput) =>
              void act(async () => {
                const made = await data.actions.createTask(input);
                navigation.replace(taskHref(key, made.number));
              })
            }
            onCancel={() => navigation.back(projectHref(key))}
          />
        </section>
      </>
    );
  }
  if (route.name === "task") {
    return (
      <TaskPage
        route={route}
        project={project}
        data={data}
        components={components}
        navigation={navigation}
        busy={busy}
        error={error}
        act={act}
      />
    );
  }
  if (route.name === "calendar") {
    const now = today();
    const month = route.month ?? monthOf(now);
    const me = data.me?.person ?? undefined;
    const shown = filterTasks(data.tasks, route.filter, me);
    const open = shown.filter((task) => OPEN_TASK_STATES.includes(task.state));
    const overdue = open.filter((task) => task.dueOn !== null && task.dueOn < now).sort(byDue);
    const unscheduled = open.filter((task) => task.dueOn === null).sort(byDue);
    const calendar = words.calendar;
    return (
      <>
        <div className="sc-page-head">
          <h1 className="sc-page-title">{calendar.title}</h1>
          <LinkButton href={newTaskHref(key)} variant="primary">
            {words.board.writeTask}
          </LinkButton>
        </div>
        {data.tasks.length > 0 && (
          <BoardFilters
            filter={route.filter}
            categories={data.categories}
            goals={data.goals}
            people={data.people.filter(inWorkspace)}
            me={me}
            shown={shown.length}
            total={data.tasks.length}
            onChange={(filter) => navigation.replace(calendarHref(key, route.month, filter))}
          />
        )}
        <components.Calendar
          tasks={shown}
          month={month}
          today={now}
          weekStart={weekStartOf(data.me?.workspace)}
          categories={data.categories}
          goals={data.goals}
          taskHref={href}
          goalHref={(goal) => goalHref(key, goal.id)}
          monthHref={(wanted) => calendarHref(key, wanted, route.filter)}
        />
        <div className="sc-calendar-below">
          <section className="sc-task-section" aria-label={calendar.overdue}>
            <h2 className="sc-section-title">
              {calendar.overdue} <span className="sc-column-count">{overdue.length}</span>
            </h2>
            <TaskList
              tasks={overdue}
              taskHref={href}
              today={now}
              showState
              empty={<p className="sc-muted">{calendar.nothingOverdue}</p>}
            />
          </section>
          <section className="sc-task-section" aria-label={calendar.unscheduled}>
            <h2 className="sc-section-title">
              {calendar.unscheduled} <span className="sc-column-count">{unscheduled.length}</span>
            </h2>
            <TaskList
              tasks={unscheduled}
              taskHref={href}
              today={now}
              showState
              empty={<p className="sc-muted">{calendar.allScheduled}</p>}
            />
          </section>
        </div>
        {open.length > 0 && (
          <section className="sc-task-section" aria-label={calendar.workload.title}>
            <h2 className="sc-section-title">{calendar.workload.title}</h2>
            <Workload
              tasks={shown}
              today={now}
              personHref={(person) =>
                boardHref(key, person === undefined ? {} : { person: person.id })
              }
            />
          </section>
        )}
      </>
    );
  }
  if (route.name === "roadmap" || route.name === "new-goal") {
    const roadmap = words.roadmap;
    const making = route.name === "new-goal";
    if (making && !owner) {
      return <EmptyState title={roadmap.onlyOwner.title} body={roadmap.onlyOwner.body} />;
    }
    return (
      <>
        <div className="sc-page-head">
          <h1 className="sc-page-title">{roadmap.title}</h1>
          {!making && owner && (
            <LinkButton href={newGoalHref(key)} variant="primary">
              {roadmap.setGoal}
            </LinkButton>
          )}
        </div>
        {error !== undefined && <Callout tone="danger">{error}</Callout>}
        {making && (
          <section className="sc-panel sc-panel-form" aria-label={roadmap.setGoalAria}>
            <GoalForm
              categories={data.categories}
              busy={busy}
              onSubmit={(input) =>
                void act(async () => {
                  const made = await data.actions.createGoal(input);
                  navigation.replace(goalHref(key, made.id));
                })
              }
              onCancel={() => navigation.back(projectHref(key, "roadmap"))}
            />
          </section>
        )}
        {data.goals.length > 0 && (
          <GoalTimeline
            goals={data.goals}
            from={
              route.name === "roadmap" && route.from !== undefined ? route.from : monthOf(today())
            }
            today={today()}
            categories={data.categories}
            goalHref={(goal) => goalHref(key, goal.id)}
            fromHref={(month) => roadmapHref(key, month)}
          />
        )}
        <components.GoalList
          goals={data.goals}
          goalHref={(goal) => goalHref(key, goal.id)}
          empty={
            <EmptyState
              title={roadmap.empty.title}
              body={roadmap.empty.body}
              action={
                owner ? (
                  <LinkButton href={newGoalHref(key)}>{roadmap.setGoal}</LinkButton>
                ) : undefined
              }
            />
          }
        />
      </>
    );
  }
  if (route.name === "goal") {
    const roadmap = words.roadmap;
    const goal = data.goals.find((candidate) => candidate.id === route.id);
    const here = goalHref(key, route.id);
    if (goal === undefined) {
      return (
        <EmptyState
          title={roadmap.noSuch.title}
          body={roadmap.noSuch.body}
          action={<LinkButton href={projectHref(key, "roadmap")}>{roadmap.all}</LinkButton>}
        />
      );
    }
    if (route.form === "edit") {
      if (!owner) {
        return <EmptyState title={roadmap.onlyOwner.title} body={roadmap.onlyOwner.body} />;
      }
      return (
        <>
          <div className="sc-page-head">
            <h1 className="sc-page-title">{goal.title}</h1>
          </div>
          {error !== undefined && <Callout tone="danger">{error}</Callout>}
          <section className="sc-panel sc-panel-form" aria-label={roadmap.editAria}>
            <GoalForm
              goal={goal}
              categories={data.categories}
              busy={busy}
              onSubmit={(input) =>
                void act(async () => {
                  await data.actions.updateGoal(goal.id, input);
                  navigation.replace(here);
                })
              }
              onCancel={() => navigation.back(here)}
            />
          </section>
        </>
      );
    }
    const now = today();
    const towards = data.tasks.filter((task) => task.goalId === goal.id);
    const month = route.month ?? goalMonth(goal, now);
    const viewHref = (view: GoalTaskView) => goalHref(key, goal.id, { view });
    return (
      <>
        <div className="sc-page-head">
          <h1 className="sc-page-title">{roadmap.one}</h1>
          <LinkButton href={projectHref(key, "roadmap")}>{roadmap.all}</LinkButton>
        </div>
        {error !== undefined && <Callout tone="danger">{error}</Callout>}
        <GoalView
          goal={goal}
          tasks={data.tasks}
          taskHref={href}
          docHref={toDoc}
          today={now}
          editHref={owner ? goalHref(key, goal.id, { form: "edit" }) : undefined}
          onMove={
            owner
              ? (target, state) =>
                  void act(async () => {
                    await data.actions.updateGoal(target.id, { state });
                    // A goal closed takes its done and dropped tasks to the archive, if the person says so (ADR-0029).
                    const closed = towards.filter(
                      (task) => !OPEN_TASK_STATES.includes(task.state),
                    ).length;
                    if (
                      (state === "done" || state === "dropped") &&
                      closed > 0 &&
                      window.confirm(roadmap.archiveAsk(closed))
                    ) {
                      await data.actions.archiveGoalTasks(target.id);
                    }
                  })
              : undefined
          }
          onArchiveTasks={
            owner && towards.some((task) => !OPEN_TASK_STATES.includes(task.state))
              ? () => void act(() => data.actions.archiveGoalTasks(goal.id))
              : undefined
          }
          busy={busy}
          view={route.view}
          viewHref={viewHref}
          board={
            <components.Board
              tasks={towards}
              taskHref={href}
              onOpen={(task) => navigation.go(href(task))}
              onMove={onMove}
              today={now}
              editHref={(task) => taskHref(key, task.number, "edit")}
              onEdit={(task) => navigation.go(taskHref(key, task.number, "edit"))}
              onArchive={(task) => void act(() => data.actions.archiveTask(task.id))}
              empty={
                towards.length === 0 ? <p className="sc-muted">{roadmap.noTasks}</p> : undefined
              }
            />
          }
          calendar={
            <components.Calendar
              tasks={towards}
              month={month}
              today={now}
              weekStart={weekStartOf(data.me?.workspace)}
              categories={data.categories}
              goals={[goal]}
              taskHref={href}
              goalHref={(target) => goalHref(key, target.id)}
              monthHref={(wanted) => goalHref(key, goal.id, { view: "calendar", month: wanted })}
            />
          }
        />
      </>
    );
  }
  if (route.name === "docs") {
    return (
      <DocsPage
        project={project}
        path={route.path}
        view={route.view}
        data={data}
        navigation={navigation}
      />
    );
  }
  if (route.name === "decisions") {
    return (
      <>
        <div className="sc-page-head">
          <h1 className="sc-page-title">{words.decisions.title}</h1>
          <LinkButton href={newDecisionHref(key)} variant="primary">
            {words.decisions.raise}
          </LinkButton>
        </div>
        {error !== undefined && <Callout tone="danger">{error}</Callout>}
        <components.DecisionList
          decisions={data.decisions}
          tasks={tasksById}
          taskHref={href}
          docHref={toDoc}
          decisionHref={(decision) => decisionHref(key, decision.id)}
          page={route.page}
          pageHref={(page) => decisionsHref(key, page)}
          onAnswer={onAnswer}
          onUpdate={onUpdate}
          busy={busy}
          empty={
            <EmptyState title={words.decisions.empty.title} body={words.decisions.empty.body} />
          }
        />
      </>
    );
  }
  if (route.name === "new-decision") {
    return (
      <>
        <div className="sc-page-head">
          <h1 className="sc-page-title">{words.decisions.raise}</h1>
        </div>
        {error !== undefined && <Callout tone="danger">{error}</Callout>}
        <section className="sc-panel sc-panel-form" aria-label={words.decisions.raiseAria}>
          <DecisionForm
            tasks={data.tasks}
            busy={busy}
            onSubmit={(input: RestDecisionInput) =>
              void act(async () => {
                const made = await data.actions.raiseDecision(input);
                navigation.replace(decisionHref(key, made.id));
              })
            }
            onCancel={() => navigation.back(projectHref(key, "decisions"))}
          />
        </section>
      </>
    );
  }
  if (route.name === "decision") {
    const decision = data.decisions.find((candidate) => candidate.id === route.id);
    return (
      <>
        <div className="sc-page-head">
          <h1 className="sc-page-title">{words.decisions.one}</h1>
          <LinkButton href={projectHref(key, "decisions")}>{words.decisions.all}</LinkButton>
        </div>
        {error !== undefined && <Callout tone="danger">{error}</Callout>}
        {decision === undefined ? (
          <EmptyState title={words.decisions.noSuch.title} body={words.decisions.noSuch.body} />
        ) : (
          <DecisionCard
            decision={decision}
            task={decision.taskId === null ? undefined : tasksById.get(decision.taskId)}
            taskHref={href}
            docHref={toDoc}
            onAnswer={onAnswer}
            onUpdate={onUpdate}
            busy={busy}
          />
        )}
      </>
    );
  }
  if (route.name === "archive") {
    return <ArchivePage project={project} data={data} />;
  }
  if (route.name === "feed") {
    return (
      <>
        <div className="sc-page-head">
          <h1 className="sc-page-title">{words.feed.title}</h1>
        </div>
        <components.EventFeed
          events={data.events}
          href={(event) => {
            const task = event.taskId === null ? undefined : tasksById.get(event.taskId);
            if (task !== undefined) {
              return href(task);
            }
            if (event.decisionId !== null) {
              return decisionHref(key, event.decisionId);
            }
            if (event.goalId !== null) {
              return goalHref(key, event.goalId);
            }
            // The rules are a page shown on the settings, not among the documents (ADR-0023).
            if (event.data.path === RULES_PATH) {
              return projectSettingsHref(key);
            }
            return event.data.path === undefined ? undefined : toDoc(event.data.path);
          }}
          empty={<EmptyState title={words.feed.empty} />}
        />
      </>
    );
  }
  if (route.name === "skills") {
    return (
      <>
        <div className="sc-page-head">
          <h1 className="sc-page-title">{words.nav.skills}</h1>
        </div>
        <components.SkillList skills={data.skills} />
      </>
    );
  }
  if (route.name === "members") {
    const me = data.me?.person ?? undefined;
    const configures = owner;
    const members = words.projects.members;
    // In a project open to the workspace everyone is a member already (ADR-0035): the list is
    // everyone, nobody is added or removed, and an owner is made from a row. Where the People
    // page shows a member only whom they share a project with, an owner lists someone the list
    // does not show by their login.
    const open = project.visibility === "workspace";
    const narrowed =
      peopleVisibilityOf(data.me?.workspace) === "shared_projects" && me?.role !== "admin";
    return (
      <>
        <div className="sc-page-head">
          <h1 className="sc-page-title">{members.title}</h1>
        </div>
        {open && <p className="sc-lead">{members.open}</p>}
        {error !== undefined && <Callout tone="danger">{error}</Callout>}
        <components.MemberList
          members={data.members}
          people={data.people.filter(inWorkspace)}
          me={me}
          open={open}
          busy={busy}
          onAdd={
            configures && !open
              ? (input) => void act(() => data.actions.addMember(input))
              : undefined
          }
          lookup={
            configures && !open && narrowed ? (login) => data.actions.findPerson(login) : undefined
          }
          onChangeRole={
            configures
              ? (member, role) =>
                  void act(() => data.actions.updateMember(member.person.id, { role }))
              : undefined
          }
          onRemove={
            configures && !open
              ? (member) => void act(() => data.actions.removeMember(member.person.id))
              : undefined
          }
          workHref={owner ? (member) => personWorkHref(member.person.id) : undefined}
          empty={
            <EmptyState
              title={members.empty.title}
              body={
                project.visibility === "workspace" ? members.empty.workspace : members.empty.private
              }
            />
          }
        />
      </>
    );
  }
  if (route.name === "settings") {
    return (
      <ProjectSettingsPage route={route} project={project} data={data} navigation={navigation} />
    );
  }
  return <NothingHere />;
}

/**
 * A project's settings (ADR-0023): read by every member, so that everyone sees what the project
 * is and what its agents are asked; changed by an owner, on the forms at their own addresses.
 */
function ProjectSettingsPage(props: {
  readonly route: Extract<Route, { name: "settings" }>;
  readonly project: RestProject;
  readonly data: ConsoleData;
  readonly navigation: Navigation;
}) {
  const words = useWords();
  const { route, project, data, navigation } = props;
  const { busy, error, act } = useAction();
  const settings = words.projects.settings;
  const form = words.projects.form;
  const owner = project.role === "owner";
  const key = project.key;
  const here = projectSettingsHref(key);
  const skills = data.me?.workspace.skills;
  const [rules, setRules] = useState<RestProjectRules | undefined>(undefined);
  const feedLength = data.events.length;
  // The rules, asked for again whenever the project's feed grows.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the feed's length is the trigger
  useEffect(() => {
    const controller = new AbortController();
    data.actions
      .projectRules(controller.signal)
      .then((found) => {
        if (!controller.signal.aborted) {
          setRules(found);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [data.actions, feedLength]);

  const head = (
    <div className="sc-page-head">
      <h1 className="sc-page-title">{settings.title}</h1>
      {owner && route.form === undefined && (
        <LinkButton href={projectSettingsHref(key, "edit")}>{words.common.edit}</LinkButton>
      )}
    </div>
  );
  if (route.form === "edit") {
    if (!owner) {
      return <NothingHere />;
    }
    return (
      <>
        {head}
        {error !== undefined && <Callout tone="danger">{error}</Callout>}
        <section className="sc-panel sc-panel-form" aria-label={settings.aria}>
          <ProjectForm
            project={project}
            busy={busy}
            skillsSource={skills?.source}
            organizationAddress={skills?.address ?? null}
            onSubmit={(input, icon) =>
              void act(async () => {
                await data.actions.updateProject(input as RestProjectPatch);
                if (icon === null) {
                  await data.actions.removeProjectIcon();
                } else if (icon !== undefined) {
                  await data.actions.setProjectIcon(uploadOf(icon));
                }
                navigation.replace(here);
              })
            }
            onCancel={() => navigation.back(here)}
          />
        </section>
      </>
    );
  }
  if (route.form === "rules") {
    if (!owner) {
      return <NothingHere />;
    }
    return (
      <>
        {head}
        {error !== undefined && <Callout tone="danger">{error}</Callout>}
        <section className="sc-panel sc-panel-form" aria-label={words.rules.projectRules}>
          {rules === undefined ? (
            <Spinner label={words.rules.loading} />
          ) : (
            <RulesForm
              rules={rules.project}
              scope="project"
              template={PROJECT_RULES_TEMPLATE}
              busy={busy}
              onSubmit={(input) =>
                void act(async () => {
                  await data.actions.writeDocument(RULES_PATH, {
                    title: RULES_TITLE,
                    body: input.body,
                    ...(input.baseVersion === undefined ? {} : { baseVersion: input.baseVersion }),
                  });
                  navigation.replace(here);
                })
              }
              onCancel={() => navigation.back(here)}
            />
          )}
        </section>
      </>
    );
  }
  if (route.form === "pack-token") {
    if (!owner) {
      return <NothingHere />;
    }
    return (
      <>
        {head}
        {error !== undefined && <Callout tone="danger">{error}</Callout>}
        <PackTokenWays
          title={settings.packToken}
          intro={words.projects.packToken.intro}
          set={project.packToken !== null}
          setAt={project.packToken?.setAt}
          busy={busy}
          onStart={data.actions.connectPackToken}
          poll={data.actions.packTokenConnection}
          onCancelConnect={data.actions.cancelPackTokenConnection}
          onConnected={() => navigation.replace(here)}
          onSubmit={(token) =>
            void act(async () => {
              await data.actions.setPackToken(token);
              navigation.replace(here);
            })
          }
          onRemove={
            project.packToken === null
              ? undefined
              : () =>
                  void act(async () => {
                    await data.actions.removePackToken();
                    navigation.replace(here);
                  })
          }
          onBack={() => navigation.back(here)}
        />
      </>
    );
  }
  return (
    <>
      {head}
      {error !== undefined && <Callout tone="danger">{error}</Callout>}
      <section className="sc-panel" aria-label={settings.aria}>
        <dl className="sc-facts sc-facts-plain">
          <div>
            <dt>{form.name}</dt>
            <dd>{project.name}</dd>
          </div>
          <div>
            <dt>{form.key}</dt>
            <dd>
              <code className="sc-project-key">{project.key}</code>
            </dd>
          </div>
          <div>
            <dt>{form.whoIsMember}</dt>
            <dd>{words.vocabulary.visibility[project.visibility]}</dd>
          </div>
          <div>
            <dt>{form.skillsAddress}</dt>
            <dd>
              {project.skillsAddress !== null ? (
                <code>
                  {skills?.source ?? ""}
                  {project.skillsAddress}
                </code>
              ) : skills?.address != null ? (
                settings.organizationsSkills(skills.address)
              ) : (
                settings.noSkills
              )}
            </dd>
          </div>
          <div>
            <dt>{settings.packToken}</dt>
            <dd>
              {project.packToken === null ? (
                <span className="sc-muted">{settings.packTokenNone}</span>
              ) : (
                <>
                  {settings.packTokenSet} <Time iso={project.packToken.setAt} />
                </>
              )}
              {owner && (
                <>
                  {" "}
                  <a href={projectSettingsHref(key, "pack-token")}>
                    {project.packToken === null ? settings.packTokenAdd : settings.packTokenEdit}
                  </a>
                </>
              )}
            </dd>
          </div>
          <div>
            <dt>{form.symbol}</dt>
            <dd>
              <ProjectMark project={project} size="sm" />
            </dd>
          </div>
          {project.description.length > 0 && (
            <div className="sc-facts-wide">
              <dt>{form.description}</dt>
              <dd>{project.description}</dd>
            </div>
          )}
        </dl>
      </section>
      <section className="sc-panel" aria-label={words.rules.projectRules}>
        <h2 className="sc-section-title">{words.rules.projectRules}</h2>
        {rules === undefined ? (
          <Spinner label={words.rules.loading} />
        ) : (
          <RulesView
            rules={rules.project}
            scope="project"
            docHref={(path) => docHref(key, path)}
            editHref={owner ? projectSettingsHref(key, "rules") : undefined}
            onArchive={
              owner
                ? () =>
                    void act(async () => {
                      await data.actions.archiveDocument(RULES_PATH);
                      setRules(await data.actions.projectRules());
                    })
                : undefined
            }
            busy={busy}
          />
        )}
      </section>
      <section className="sc-panel" aria-label={words.rules.workspaceRules}>
        <div className="sc-section-head">
          <h2 className="sc-section-title">{words.rules.workspaceRules}</h2>
          <a className="sc-muted" href={settingsHref()}>
            {words.rules.onWorkspaceSettings}
          </a>
        </div>
        {rules !== undefined && <RulesView rules={rules.workspace} scope="workspace" folded />}
      </section>
    </>
  );
}

/**
 * The workspace's settings (ADR-0023): its rules, the console's own until an administrator
 * writes the organization's; its categories, kept on their own page; and where its skills come
 * from, which whoever runs the console set. Read by everyone; the rules written by an administrator.
 */
function WorkspaceSettingsPage(props: {
  readonly form: "rules" | "workspace" | "pack-token" | undefined;
  readonly data: ConsoleData;
  readonly navigation: Navigation;
}) {
  const words = useWords();
  const { form, data, navigation } = props;
  const { busy, error, act } = useAction();
  const administrator = data.me?.person?.role === "admin";
  const workspace = data.me?.workspace;
  const skills = workspace?.skills;
  const [rules, setRules] = useState<RestRules | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    data.actions
      .rules(controller.signal)
      .then((found) => {
        if (!controller.signal.aborted) {
          setRules(found);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [data.actions]);

  const head = (
    <div className="sc-page-head">
      <h1 className="sc-page-title">{words.settings.title}</h1>
    </div>
  );
  if (form === "rules") {
    if (!administrator) {
      return <NothingHere />;
    }
    return (
      <>
        {head}
        {error !== undefined && <Callout tone="danger">{error}</Callout>}
        <section className="sc-panel sc-panel-form" aria-label={words.rules.title}>
          {rules === undefined ? (
            <Spinner label={words.rules.loading} />
          ) : (
            <RulesForm
              rules={rules}
              scope="workspace"
              template={REFERENCE_RULES}
              busy={busy}
              onSubmit={(input) =>
                void act(async () => {
                  setRules(
                    await data.actions.writeRules({
                      body: input.body,
                      ...(input.baseVersion === undefined
                        ? {}
                        : { baseVersion: input.baseVersion }),
                    }),
                  );
                  navigation.replace(PATHS.settings);
                })
              }
              onCancel={() => navigation.back(PATHS.settings)}
              onReset={() =>
                void act(async () => {
                  setRules(await data.actions.archiveRules());
                  navigation.replace(PATHS.settings);
                })
              }
            />
          )}
        </section>
      </>
    );
  }
  if (form === "pack-token") {
    if (!administrator || workspace === undefined) {
      return <NothingHere />;
    }
    const held = workspace.skills.packToken ?? null;
    return (
      <>
        {head}
        {error !== undefined && <Callout tone="danger">{error}</Callout>}
        <PackTokenWays
          title={words.settings.skillsToken}
          intro={words.settings.skillsTokenIntro}
          set={held !== null}
          setAt={held?.setAt}
          busy={busy}
          onStart={data.actions.connectWorkspacePackToken}
          poll={data.actions.workspacePackTokenConnection}
          onCancelConnect={data.actions.cancelWorkspacePackTokenConnection}
          onConnected={() => navigation.replace(PATHS.settings)}
          onSubmit={(token) =>
            void act(async () => {
              await data.actions.setWorkspacePackToken(token);
              navigation.replace(PATHS.settings);
            })
          }
          onRemove={
            held === null
              ? undefined
              : () =>
                  void act(async () => {
                    await data.actions.removeWorkspacePackToken();
                    navigation.replace(PATHS.settings);
                  })
          }
          onBack={() => navigation.back(PATHS.settings)}
        />
      </>
    );
  }
  if (form === "workspace") {
    if (!administrator || workspace === undefined) {
      return <NothingHere />;
    }
    return (
      <>
        {head}
        {error !== undefined && <Callout tone="danger">{error}</Callout>}
        <section className="sc-panel sc-panel-form" aria-label={words.settings.workspace.aria}>
          <h2 className="sc-section-title">{words.settings.workspace.title}</h2>
          <WorkspaceSettingsForm
            workspace={workspace}
            busy={busy}
            onSubmit={(patch) =>
              void act(async () => {
                await data.actions.updateWorkspace(patch);
                navigation.replace(PATHS.settings);
              })
            }
            onCancel={() => navigation.back(PATHS.settings)}
          />
        </section>
      </>
    );
  }
  return (
    <>
      {head}
      {error !== undefined && <Callout tone="danger">{error}</Callout>}
      {workspace !== undefined && (
        <section className="sc-panel" aria-label={words.settings.workspace.aria}>
          <div className="sc-section-head">
            <h2 className="sc-section-title">{words.settings.workspace.title}</h2>
            {administrator && (
              <a
                className="sc-button sc-button-secondary sc-button-sm"
                href={settingsHref("workspace")}
              >
                {words.common.edit}
              </a>
            )}
          </div>
          <WorkspaceSettingsView workspace={workspace} />
        </section>
      )}
      <section className="sc-panel" aria-label={words.rules.title}>
        <h2 className="sc-section-title">{words.rules.title}</h2>
        {rules === undefined ? (
          <Spinner label={words.rules.loading} />
        ) : (
          <RulesView
            rules={rules}
            scope="workspace"
            editHref={administrator ? settingsHref("rules") : undefined}
            onArchive={
              administrator
                ? () =>
                    void act(async () => {
                      setRules(await data.actions.archiveRules());
                    })
                : undefined
            }
            busy={busy}
          />
        )}
      </section>
      <section className="sc-panel" aria-label={words.settings.categories}>
        <h2 className="sc-section-title">{words.settings.categories}</h2>
        {data.categories.length > 0 && (
          <p className="sc-category-chips">
            {data.categories.map((category) => (
              <CategoryBadge key={category.key} category={category} />
            ))}
          </p>
        )}
        <LinkButton href={PATHS.categories}>{words.settings.manageCategories}</LinkButton>
      </section>
      {skills !== undefined && (
        <section className="sc-panel" aria-label={words.settings.skills}>
          <h2 className="sc-section-title">{words.settings.skills}</h2>
          <dl className="sc-facts sc-facts-plain">
            <div>
              <dt>{words.settings.skillsSource}</dt>
              <dd>
                <a href={skills.source} target="_blank" rel="noopener noreferrer">
                  {skills.source}
                </a>
              </dd>
            </div>
            <div>
              <dt>{words.settings.skillsAddress}</dt>
              <dd>
                {skills.address === null ? (
                  words.settings.noSkillsAddress
                ) : (
                  <a
                    href={`${skills.source}${skills.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <code>{skills.address}</code>
                  </a>
                )}
              </dd>
            </div>
            {skills.address !== null && (
              <div>
                <dt>{words.settings.skillsToken}</dt>
                <dd>
                  {skills.packToken == null ? (
                    <span className="sc-muted">{words.projects.settings.packTokenNone}</span>
                  ) : (
                    <>
                      {words.projects.settings.packTokenSet} <Time iso={skills.packToken.setAt} />
                    </>
                  )}
                  {administrator && (
                    <>
                      {" "}
                      <a href={settingsHref("pack-token")}>
                        {skills.packToken == null
                          ? words.projects.settings.packTokenAdd
                          : words.projects.settings.packTokenEdit}
                      </a>
                    </>
                  )}
                </dd>
              </div>
            )}
          </dl>
          <p className="sc-muted">{words.settings.skillsFromConfiguration}</p>
        </section>
      )}
    </>
  );
}

/** A file a person chose, as the client sends it: its name, its bytes and the type the browser says. */
/** Whether a person is in: who a picker of assignees and of members offers (ADR-0022). */
const inWorkspace = (person: { readonly status: "active" | "deactivated" }): boolean =>
  person.status === "active";

const uploadOf = (file: File): FileUpload => ({
  name: file.name,
  bytes: file,
  ...(file.type === "" ? {} : { contentType: file.type }),
});

function NothingHere() {
  const words = useWords();
  return (
    <EmptyState
      title={words.common.nothingHere.title}
      body={words.common.nothingHere.body}
      action={<LinkButton href={PATHS.projects}>{words.nav.projects}</LinkButton>}
    />
  );
}

/** One person's agents, for an administrator: read on their own, and taken away from here. */
function PersonAgentsPage(props: {
  readonly id: string;
  readonly data: ConsoleData;
  readonly components: ConsoleComponents;
}) {
  const words = useWords();
  const { id, data, components } = props;
  const me = data.me?.person ?? undefined;
  const administrator = me?.role === "admin";
  const person = data.people.find((candidate) => candidate.id === id);
  const [tokens, setTokens] = useState<readonly RestToken[] | undefined>(undefined);
  const [generation, setGeneration] = useState(0);
  const { busy, error, act } = useAction();
  const { personTokens } = data.actions;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `generation` is the trigger
  useEffect(() => {
    if (!administrator) {
      return;
    }
    const controller = new AbortController();
    personTokens(id, controller.signal)
      .then((answer) => {
        if (!controller.signal.aborted) {
          setTokens(answer.items);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [id, administrator, personTokens, generation]);
  if (!administrator) {
    return (
      <EmptyState
        title={words.people.onlyAdmin.title}
        body={words.people.onlyAdmin.body}
        action={<LinkButton href={PATHS.agents}>{words.nav.agents}</LinkButton>}
      />
    );
  }
  return (
    <>
      <div className="sc-page-head">
        <h1 className="sc-page-title">
          {words.people.agentsOf(person === undefined ? "?" : personName(person))}
        </h1>
        <LinkButton href={PATHS.people}>{words.nav.people}</LinkButton>
      </div>
      {error !== undefined && <Callout tone="danger">{error}</Callout>}
      {tokens === undefined ? (
        <div className="sc-loading">
          <Spinner label={words.people.loadingAgents} />
        </div>
      ) : (
        <components.TokenList
          tokens={tokens}
          busy={busy}
          consoleVersion={data.me?.console?.version}
          onRevoke={(token) =>
            void act(async () => {
              await data.actions.revokePersonToken(id, token.id);
              setGeneration((current) => current + 1);
            })
          }
          empty={<EmptyState title={words.people.noAgent} />}
        />
      )}
    </>
  );
}

/** What a plate's page shows: the tasks, open and lately closed, and the decisions waiting on the person's own. */
interface Plate {
  readonly tasks: RestWork["tasks"];
  readonly closed?: RestWork["closed"] | undefined;
  readonly decisions?: RestWork["decisions"] | undefined;
}

/**
 * A plate, read when the page is opened: the person's own, or another person's for whoever
 * oversees them. The week at the top is the address's.
 */
function PlatePage(props: {
  readonly components: ConsoleComponents;
  /** Reads the plate; stable across renders, since the page reads again whenever it changes. */
  readonly load: (signal: AbortSignal) => Promise<Plate>;
  readonly title: string;
  /** What stands beside the title: the way back, on another person's plate. */
  readonly aside?: ReactNode;
  /** A day of the week shown at the top, from the address; today's week when it names none. */
  readonly week: string | undefined;
  readonly weekHref: (day: string) => string;
  readonly loading: string;
  readonly couldNotLoad: string;
  readonly empty: { readonly title: string; readonly body: string };
  /** What a refusal says where the plate may not be the asker's to see; the server's words otherwise. */
  readonly refused?: { readonly title: string; readonly body: string } | undefined;
  /** The day the week begins on, as the workspace says (ADR-0035). */
  readonly weekStart?: WeekStart | undefined;
}) {
  const words = useWords();
  const { components, load, couldNotLoad, refused } = props;
  const [plate, setPlate] = useState<Plate | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [forbidden, setForbidden] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setPlate(undefined);
    setProblem(undefined);
    setForbidden(false);
    load(controller.signal)
      .then((answer) => {
        if (!controller.signal.aborted) {
          setPlate(answer);
        }
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        if (
          refused !== undefined &&
          failure instanceof ApiError &&
          failure.code === "auth.forbidden"
        ) {
          setForbidden(true);
        } else {
          setProblem(errorWords(failure, couldNotLoad));
        }
      });
    return () => controller.abort();
  }, [load, couldNotLoad, refused]);
  return (
    <>
      <div className="sc-page-head">
        <h1 className="sc-page-title">{props.title}</h1>
        {props.aside}
      </div>
      {problem !== undefined && <Callout tone="danger">{problem}</Callout>}
      {forbidden && refused !== undefined ? (
        <EmptyState
          title={refused.title}
          body={refused.body}
          action={<LinkButton href={PATHS.work}>{words.nav.work}</LinkButton>}
        />
      ) : plate === undefined ? (
        problem === undefined && (
          <div className="sc-loading">
            <Spinner label={props.loading} />
          </div>
        )
      ) : plate.tasks.length === 0 &&
        (plate.closed?.length ?? 0) === 0 &&
        (plate.decisions?.length ?? 0) === 0 ? (
        <EmptyState title={props.empty.title} body={props.empty.body} />
      ) : (
        <components.WorkList
          work={plate}
          week={props.week}
          weekStart={props.weekStart}
          taskHref={(projectKey, task) => taskHref(projectKey, task.number)}
          decisionHref={(projectKey, decisionId) => decisionHref(projectKey, decisionId)}
          weekHref={props.weekHref}
        />
      )}
    </>
  );
}

/** What is on the person's own plate, across their projects. */
function WorkPage(props: {
  readonly data: ConsoleData;
  readonly components: ConsoleComponents;
  readonly week: string | undefined;
}) {
  const words = useWords();
  const { work } = props.data.actions;
  return (
    <PlatePage
      components={props.components}
      load={work}
      title={words.work.title}
      week={props.week}
      weekStart={weekStartOf(props.data.me?.workspace)}
      weekHref={workHref}
      loading={words.work.loading}
      couldNotLoad={words.work.couldNotLoad}
      empty={words.work.empty}
    />
  );
}

/** Another person's plate, for whoever oversees them: an administrator, or an owner of a project they are in. */
function PersonWorkPage(props: {
  readonly id: string;
  readonly data: ConsoleData;
  readonly components: ConsoleComponents;
  readonly week: string | undefined;
}) {
  const words = useWords();
  const { id, data } = props;
  const person = data.people.find((candidate) => candidate.id === id);
  const name = person === undefined ? "?" : personName(person);
  const { personWork } = data.actions;
  const load = useCallback((signal: AbortSignal) => personWork(id, signal), [personWork, id]);
  return (
    <PlatePage
      components={props.components}
      load={load}
      title={words.people.workOf(name)}
      aside={<LinkButton href={PATHS.people}>{words.nav.people}</LinkButton>}
      week={props.week}
      weekStart={weekStartOf(data.me?.workspace)}
      weekHref={(day) => personWorkHref(id, day)}
      loading={words.people.loadingWork}
      couldNotLoad={words.people.couldNotLoadWork}
      empty={{ title: words.people.noWork.title(name), body: words.people.noWork.body }}
      refused={words.people.notOverseen}
    />
  );
}

function WorkspacePage(props: {
  readonly route: Route;
  readonly data: ConsoleData;
  readonly components: ConsoleComponents;
  readonly navigation: Navigation;
}) {
  const words = useWords();
  const { route, data, components, navigation } = props;
  const [fresh, setFresh] = useState<RestTokenCreated | undefined>(undefined);
  const { busy, error, act } = useAction();

  if (route.name === "work") {
    return <WorkPage data={data} components={components} week={route.week} />;
  }
  if (route.name === "person-work") {
    return <PersonWorkPage id={route.id} data={data} components={components} week={route.week} />;
  }
  if (route.name === "workspace-settings") {
    return <WorkspaceSettingsPage form={route.form} data={data} navigation={navigation} />;
  }
  if (route.name === "categories") {
    const me = data.me?.person ?? undefined;
    const administrator = me?.role === "admin";
    const categories = words.categories;
    return (
      <>
        <div className="sc-page-head">
          <h1 className="sc-page-title">{categories.title}</h1>
        </div>
        {error !== undefined && <Callout tone="danger">{error}</Callout>}
        <components.CategoryList
          categories={data.categories}
          busy={busy}
          onAdd={
            administrator
              ? (input) => void act(() => data.actions.createCategory(input))
              : undefined
          }
          onChange={
            administrator
              ? (category, patch) =>
                  void act(() => data.actions.updateCategory(category.key, patch))
              : undefined
          }
          onRemove={
            administrator
              ? (category) => void act(() => data.actions.removeCategory(category.key))
              : undefined
          }
          empty={<EmptyState title={categories.empty.title} body={categories.empty.body} />}
        />
      </>
    );
  }

  if (route.name === "people" || route.name === "new-listing") {
    const me = data.me?.person ?? undefined;
    const administrator = me?.role === "admin";
    const making = route.name === "new-listing" && administrator;
    // An owner sees the work of the people in their projects; the console refuses the rest.
    const oversees = administrator || data.projects.some((project) => project.role === "owner");
    // The list is what the policy shows (ADR-0035): everyone, or the people one shares a project with.
    const narrowed = peopleVisibilityOf(data.me?.workspace) === "shared_projects" && !administrator;
    return (
      <>
        <div className="sc-page-head">
          <h1 className="sc-page-title">{words.people.title}</h1>
          {administrator && !making && (
            <LinkButton href={PATHS.newListing} variant="primary">
              {words.people.letIn}
            </LinkButton>
          )}
        </div>
        {narrowed && <p className="sc-lead">{words.people.narrowed}</p>}
        {error !== undefined && <Callout tone="danger">{error}</Callout>}
        {making && (
          <section className="sc-panel sc-panel-form" aria-label={words.people.letInAria}>
            <ListingForm
              providers={data.me?.signIn ?? []}
              busy={busy}
              onSubmit={(input) =>
                void act(async () => {
                  await data.actions.createListing(input);
                  navigation.replace(PATHS.people);
                })
              }
              onCancel={() => navigation.back(PATHS.people)}
            />
          </section>
        )}
        <components.PeopleList
          people={data.people}
          listed={data.listed}
          organization={data.organization}
          me={me}
          busy={busy}
          onChangeRole={
            administrator
              ? (person, role) => void act(() => data.actions.updatePerson(person.id, { role }))
              : undefined
          }
          onChangeStatus={
            administrator
              ? (person, status) => void act(() => data.actions.updatePerson(person.id, { status }))
              : undefined
          }
          onUnlist={
            administrator
              ? (listing) => void act(() => data.actions.removeListing(listing.id))
              : undefined
          }
          workHref={oversees ? (person) => personWorkHref(person.id) : undefined}
          agentsHref={administrator ? (person) => personAgentsHref(person.id) : undefined}
        />
      </>
    );
  }
  if (route.name === "person-agents") {
    return <PersonAgentsPage id={route.id} data={data} components={components} />;
  }
  if (route.name === "connect") {
    return <ConnectPage code={route.code} data={data} navigation={navigation} />;
  }
  if (route.name === "agents" || route.name === "new-token") {
    const agents = words.agents;
    const making = route.name === "new-token";
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    return (
      <>
        <div className="sc-page-head">
          <h1 className="sc-page-title">{agents.title}</h1>
          {!making && (
            <LinkButton href={PATHS.newToken} variant="primary">
              {agents.makeByHand}
            </LinkButton>
          )}
        </div>
        {error !== undefined && <Callout tone="danger">{error}</Callout>}
        {fresh !== undefined && (
          <NewToken token={fresh.token} secret={fresh.secret} onDone={() => setFresh(undefined)} />
        )}
        {making && (
          <section className="sc-panel sc-panel-form" aria-label={agents.makeAria}>
            <TokenForm
              daysAtMost={data.me?.workspace.tokenDaysAtMost}
              busy={busy}
              onSubmit={(input) =>
                void act(async () => {
                  setFresh(await data.actions.createToken(input));
                  navigation.replace(PATHS.agents);
                })
              }
              onCancel={() => navigation.back(PATHS.agents)}
            />
          </section>
        )}
        <components.TokenList
          tokens={data.tokens}
          busy={busy}
          consoleVersion={data.me?.console?.version}
          onRevoke={(token) => void act(() => data.actions.revokeToken(token.id))}
          empty={<EmptyState title={agents.empty.title} body={agents.empty.body} />}
        />
        <ConnectWords origin={origin} />
      </>
    );
  }
  return <NothingHere />;
}

export function createConsole(config: ConsoleConfig = {}): ConsoleApp {
  const components: ConsoleComponents = { ...DEFAULT_COMPONENTS, ...config.components };
  const client = config.client ?? createClient({ baseUrl: config.baseUrl ?? "" });
  const fallbackTitle = config.title ?? "Console";
  const languages = config.languages ?? DEFAULT_LANGUAGES;
  const pages = config.pages ?? [];

  function App(props: { readonly initialPath?: string | undefined }) {
    const { location, navigation } = useNavigation(props.initialPath);
    useFollowLinks(navigation);
    const route = useMemo(
      () => matchRoute(location.pathname, location.search),
      [location.pathname, location.search],
    );
    const projectKey = projectOf(route);
    const data = useConsoleData(client, projectKey);
    const failure = signInFailureOf(location.search);
    const title = data.me?.workspace.name ?? fallbackTitle;
    const viaToken = holdsToken(data);
    // The language: the person's choice, else the browser's, else the first the console speaks.
    const chosen = data.me?.language;
    const pack = useMemo(
      () =>
        chooseLanguage(
          chosen,
          typeof navigator === "undefined" ? [] : navigator.languages,
          languages,
        ),
      [chosen],
    );
    const words = pack.messages;

    // An address that moved is shown at its new one, in its place.
    useEffect(() => {
      if (route.name === "moved") {
        navigation.replace(route.to);
      }
    }, [route, navigation]);

    useEffect(() => {
      if (typeof document !== "undefined") {
        document.title = data.project === undefined ? title : `${data.project.name} · ${title}`;
        document.documentElement.lang = pack.tag;
      }
    }, [title, data.project, pack.tag]);

    let content: React.ReactNode;
    if (data.me === undefined) {
      content = (
        <Ground>
          <div className="sc-loading">
            {data.error === undefined ? (
              <Spinner label={words.common.loading} />
            ) : (
              <Callout
                tone="danger"
                title={words.common.couldNotReach}
                action={<Button onClick={data.reload}>{words.common.tryAgain}</Button>}
              >
                {data.error}
              </Callout>
            )}
          </div>
        </Ground>
      );
    } else if (data.me.person === null) {
      content = (
        <Ground>
          <components.SignIn
            title={title}
            brand={config.brand}
            providers={data.me.signIn}
            returnTo={withoutSignInParam(location.pathname, location.search)}
            failure={failure}
          />
        </Ground>
      );
    } else {
      const project = data.project;
      const waiting = data.decisions.filter((decision) => decision.answer === null).length;
      const workspaceNav: NavItem[] = [
        {
          href: PATHS.projects,
          label: words.nav.projects,
          current: route.name === "projects" || route.name === "new-project",
        },
        { href: PATHS.work, label: words.nav.work, current: route.name === "work" },
        {
          href: PATHS.people,
          label: words.nav.people,
          current:
            route.name === "people" ||
            route.name === "new-listing" ||
            route.name === "person-agents",
        },
        ...(viaToken
          ? []
          : [
              {
                href: PATHS.agents,
                label: words.nav.agents,
                current: route.name === "agents" || route.name === "new-token",
              },
            ]),
        // The settings are read by everyone: the rules every agent follows, the categories and
        // what the colours mean, where the skills come from; kept by an administrator.
        {
          href: PATHS.settings,
          label: words.nav.settings,
          current: route.name === "workspace-settings" || route.name === "categories",
        },
        ...pages
          .filter((candidate) => candidate.level === "workspace")
          .map((candidate) => ({
            href: customPageHref(candidate.key),
            label: customPageLabel(candidate, pack.tag),
            current:
              route.name === "custom" &&
              route.level === "workspace" &&
              route.page === candidate.key,
          })),
      ];
      const nav: NavItem[] =
        projectKey === undefined
          ? workspaceNav
          : [
              {
                href: projectHref(projectKey),
                label: words.nav.board,
                current:
                  route.name === "board" || route.name === "task" || route.name === "new-task",
              },
              {
                href: projectHref(projectKey, "roadmap"),
                label: words.nav.roadmap,
                current:
                  route.name === "roadmap" || route.name === "goal" || route.name === "new-goal",
              },
              {
                href: projectHref(projectKey, "calendar"),
                label: words.nav.calendar,
                current: route.name === "calendar",
              },
              {
                href: projectHref(projectKey, "docs"),
                label: words.nav.docs,
                current: route.name === "docs",
              },
              {
                href: projectHref(projectKey, "decisions"),
                label: words.nav.decisions,
                current:
                  route.name === "decisions" ||
                  route.name === "decision" ||
                  route.name === "new-decision",
                count: waiting,
              },
              {
                href: projectHref(projectKey, "feed"),
                label: words.nav.feed,
                current: route.name === "feed",
              },
              {
                href: projectHref(projectKey, "skills"),
                label: words.nav.skills,
                current: route.name === "skills",
              },
              {
                href: projectHref(projectKey, "members"),
                label: words.nav.members,
                current: route.name === "members",
              },
              // Read by every member: what the project is, and what its agents are asked (ADR-0023).
              {
                href: projectHref(projectKey, "settings"),
                label: words.nav.settings,
                current: route.name === "settings",
              },
              ...pages
                .filter((candidate) => candidate.level === "project")
                .map((candidate) => ({
                  href: customPageHref(candidate.key, projectKey),
                  label: customPageLabel(candidate, pack.tag),
                  current:
                    route.name === "custom" &&
                    route.level === "project" &&
                    route.page === candidate.key,
                })),
            ];
      /** A page of the console's own at the address, or nothing there. */
      const customPageOf = (key: string, level: CustomPage["level"]): ReactNode => {
        const found = pages.find((candidate) => candidate.key === key && candidate.level === level);
        return found === undefined ? (
          <NothingHere />
        ) : (
          found.render({ data, project, client, navigation, words, language: pack.tag })
        );
      };
      let page: ReactNode;
      if (!data.loaded || route.name === "moved") {
        page = (
          <div className="sc-loading">
            <Spinner label={words.common.loadingWorkspace} />
          </div>
        );
      } else if (viaToken && onlyOnOwnPages(route)) {
        page = <NotWithToken />;
      } else if (route.name === "projects" || route.name === "new-project") {
        page = (
          <ProjectsPage
            data={data}
            components={components}
            navigation={navigation}
            making={route.name === "new-project"}
          />
        );
      } else if (route.name === "custom" && route.level === "workspace") {
        page = customPageOf(route.page, "workspace");
      } else if (projectKey === undefined) {
        page = (
          <WorkspacePage
            route={route}
            data={data}
            components={components}
            navigation={navigation}
          />
        );
      } else if (data.projectError !== undefined) {
        page = (
          <EmptyState
            title={words.common.noSuchProject.title}
            body={words.common.noSuchProject.body}
            action={<LinkButton href={PATHS.projects}>{words.nav.projects}</LinkButton>}
          />
        );
      } else if (!data.projectLoaded || project === undefined) {
        page = (
          <div className="sc-loading">
            <Spinner label={words.common.loadingProject} />
          </div>
        );
      } else if (route.name === "custom") {
        page = customPageOf(route.page, "project");
      } else {
        page = (
          <ProjectPage
            route={route}
            project={project}
            data={data}
            components={components}
            navigation={navigation}
          />
        );
      }
      content = (
        <components.Shell
          title={title}
          brand={config.brand}
          project={
            projectKey === undefined
              ? undefined
              : {
                  name: project?.name ?? projectKey,
                  href: projectHref(projectKey),
                  mark:
                    project === undefined ? undefined : <ProjectMark project={project} size="sm" />,
                }
          }
          nav={nav}
          menu={workspaceNav}
          languages={languages.map((candidate) => ({
            tag: candidate.tag,
            label: candidate.label,
            current: candidate.tag === pack.tag,
          }))}
          onLanguage={(tag) => void data.actions.updateMe({ language: tag }).catch(() => undefined)}
          person={data.me.person}
          live={projectKey === undefined ? undefined : data.live}
          wide={
            route.name === "board" ||
            route.name === "calendar" ||
            (route.name === "goal" && route.form === undefined) ||
            (route.name === "custom" &&
              pages.some((candidate) => candidate.key === route.page && candidate.wide === true))
          }
          onNavigate={(href) => navigation.go(href)}
          onSignOut={viaToken ? undefined : () => void data.actions.signOut()}
        >
          {page}
        </components.Shell>
      );
    }
    return <LanguageContext.Provider value={pack}>{content}</LanguageContext.Provider>;
  }

  return {
    App,
    mount(container) {
      const root: Root = createRoot(container);
      root.render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
      return () => root.unmount();
    },
  };
}
