import { type ComponentType, StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  ApiError,
  type ConsoleClient,
  createClient,
  type RestAnswerInput,
  type RestDecision,
  type RestDecisionInput,
  type RestEvent,
  type RestProject,
  type RestProjectInput,
  type RestProjectPatch,
  type RestTask,
  type RestTaskInput,
  type RestTokenCreated,
  type TaskState,
} from "./api.js";
import { Board, type BoardProps } from "./components/board.js";
import { DecisionForm } from "./components/decision-form.js";
import { DecisionList, type DecisionListProps } from "./components/decision-list.js";
import { EventFeed, type EventFeedProps } from "./components/event-feed.js";
import { PeopleList, type PeopleListProps } from "./components/people.js";
import {
  MemberList,
  type MemberListProps,
  ProjectForm,
  ProjectList,
  type ProjectListProps,
} from "./components/projects.js";
import { Shell, type ShellProps } from "./components/shell.js";
import { SignIn, type SignInProps } from "./components/sign-in.js";
import { SkillList, type SkillListProps } from "./components/skills.js";
import { TaskForm } from "./components/task-form.js";
import { TaskView, type TaskViewProps } from "./components/task-view.js";
import { NewToken, TokenForm, TokenList, type TokenListProps } from "./components/tokens.js";
import { Button, Callout, EmptyState, Spinner } from "./components/ui.js";
import { type ConsoleData, useConsoleData } from "./data.js";
import {
  matchRoute,
  PATHS,
  projectHref,
  type Route,
  signInFailureOf,
  taskHref,
  withoutSignInParam,
} from "./router.js";
import { projectPath } from "./routes.js";

// The composition of the default console: the pages assembled from the components, with the
// places a team may replace named. The UI the image serves is this, with the default config.
// The front page is the projects; a project's pages are under its key (ADR-0008).

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
};

export interface ConsoleConfig {
  /** The origin of the console's API. Left out, the page's own origin. */
  readonly baseUrl?: string | undefined;
  /** What the board is called before the server says; the server's name wins once it answers. */
  readonly title?: string | undefined;
  /** The components to use in place of the default ones. */
  readonly components?: Partial<ConsoleComponents> | undefined;
  /** The client to talk to the server with; made from `baseUrl` when left out. For tests. */
  readonly client?: ConsoleClient | undefined;
}

export interface ConsoleApp {
  /** The whole console as one component, for a custom page to place. */
  readonly App: ComponentType<{ readonly initialPath?: string | undefined }>;
  /** Renders the console into `container`. Returns the way to take it down again. */
  mount(container: Element): () => void;
}

/** The browser's location, as the app reads it; a given path while rendering elsewhere. */
function useLocation(initialPath: string | undefined) {
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
  const navigate = useCallback(
    (href: string, replace = false) => {
      if (typeof window === "undefined") {
        return;
      }
      if (replace) {
        window.history.replaceState(null, "", href);
      } else {
        window.history.pushState(null, "", href);
        window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      }
      setLocation(read());
    },
    [read],
  );
  return { location, navigate };
}

function errorWords(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  return "Something went wrong. Try again.";
}

/** Runs a change, keeps what went wrong for the page, and says when it is busy. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (failure) {
      setError(errorWords(failure));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, act };
}

/** The key of the project a route is on, or nothing. */
const projectOf = (route: Route): string | undefined =>
  "project" in route ? route.project : undefined;

function ProjectsPage(props: {
  readonly data: ConsoleData;
  readonly components: ConsoleComponents;
  readonly navigate: (href: string) => void;
}) {
  const { data, components, navigate } = props;
  const [making, setMaking] = useState(false);
  const { busy, error, act } = useAction();
  const href = (project: RestProject) => projectHref(project.key);
  return (
    <>
      <div className="sc-page-head">
        <h1 className="sc-page-title">Projects</h1>
        <Button variant="primary" onClick={() => setMaking(true)} disabled={making}>
          New project
        </Button>
      </div>
      <p className="sc-lead">
        A project holds its board, its skills and its people. What you may see and change is decided
        per project: an owner configures it, a member works on it.
      </p>
      {error !== undefined && <Callout tone="danger">{error}</Callout>}
      {making && (
        <section className="sc-panel" aria-label="New project">
          <ProjectForm
            busy={busy}
            onSubmit={(input) =>
              void act(async () => {
                const made = await data.actions.createProject(input as RestProjectInput);
                setMaking(false);
                navigate(projectHref(made.key));
              })
            }
            onCancel={() => setMaking(false)}
          />
        </section>
      )}
      <components.ProjectList
        projects={data.projects}
        projectHref={href}
        onOpen={(project) => navigate(href(project))}
        empty={
          <EmptyState
            title="No projects yet"
            body="Make the first one: what it is for, and who is in it. Or ask an owner to add you to theirs."
            action={<Button onClick={() => setMaking(true)}>New project</Button>}
          />
        }
      />
    </>
  );
}

function TaskPage(props: {
  readonly project: RestProject;
  readonly task: RestTask;
  readonly data: ConsoleData;
  readonly components: ConsoleComponents;
  readonly busy: boolean;
  readonly error: string | undefined;
  readonly act: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const { project, task, data, components, busy, error, act } = props;
  const [history, setHistory] = useState<readonly RestEvent[] | undefined>(undefined);
  const { taskHistory } = data.actions;
  // Everything that happened to the task, asked for again whenever the project's feed grows.
  const feedLength = data.events.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the feed's length is the trigger
  useEffect(() => {
    const controller = new AbortController();
    taskHistory(task.id, controller.signal)
      .then((events) => {
        if (!controller.signal.aborted) {
          setHistory(events);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [task.id, taskHistory, feedLength]);
  return (
    <components.TaskView
      task={task}
      people={data.people}
      tasks={data.tasks}
      decisions={data.decisions}
      runs={data.runs}
      history={history}
      taskHref={(candidate) => taskHref(project.key, candidate.id)}
      decisionHref={() => projectHref(project.key, "decisions")}
      fileHref={(artifact) => projectPath(project.key, "files", artifact.id)}
      busy={busy}
      error={error}
      onChange={(target, patch) => void act(() => data.actions.updateTask(target.id, patch))}
      onMove={(target, state) => void act(() => data.actions.updateTask(target.id, { state }))}
      onRaiseDecision={(input) => void act(() => data.actions.raiseDecision(input))}
      onAnswer={(decision, input) =>
        void act(() => data.actions.answerDecision(decision.id, input))
      }
      onAbandonRun={(run) => void act(() => data.actions.abandonRun(run.id))}
    />
  );
}

function ProjectPage(props: {
  readonly route: Route;
  readonly project: RestProject;
  readonly data: ConsoleData;
  readonly components: ConsoleComponents;
  readonly navigate: (href: string) => void;
}) {
  const { route, project, data, components, navigate } = props;
  const [writing, setWriting] = useState(false);
  const [asking, setAsking] = useState(false);
  const { busy, error, act } = useAction();
  const tasksById = useMemo(() => new Map(data.tasks.map((task) => [task.id, task])), [data.tasks]);
  const href = (task: RestTask) => taskHref(project.key, task.id);
  const owner = project.role === "owner";

  const onMove = (task: RestTask, state: TaskState) =>
    void act(() => data.actions.updateTask(task.id, { state }));
  const onAnswer = (decision: RestDecision, input: RestAnswerInput) =>
    void act(() => data.actions.answerDecision(decision.id, input));

  if (route.name === "board") {
    return (
      <>
        <div className="sc-page-head">
          <h1 className="sc-page-title">{project.name}</h1>
          <Button variant="primary" onClick={() => setWriting(true)} disabled={writing}>
            Write a task
          </Button>
        </div>
        {project.description.length > 0 && <p className="sc-lead">{project.description}</p>}
        {error !== undefined && <Callout tone="danger">{error}</Callout>}
        {writing && (
          <section className="sc-panel" aria-label="Write a task">
            <TaskForm
              people={data.people}
              parents={data.tasks}
              busy={busy}
              onSubmit={(input: RestTaskInput) =>
                void act(async () => {
                  await data.actions.createTask(input);
                  setWriting(false);
                })
              }
              onCancel={() => setWriting(false)}
            />
          </section>
        )}
        <components.Board
          tasks={data.tasks}
          taskHref={href}
          onOpen={(task) => navigate(href(task))}
          onMove={onMove}
          empty={
            data.tasks.length === 0 ? (
              <EmptyState
                title="Nothing on the board yet"
                body="Write the first task: what is to be done, and for whom."
                action={<Button onClick={() => setWriting(true)}>Write a task</Button>}
              />
            ) : undefined
          }
        />
      </>
    );
  }
  if (route.name === "task") {
    const task = tasksById.get(route.id);
    if (task === undefined) {
      return (
        <EmptyState
          title="No such task"
          body="It may belong to another project, or the link is wrong."
        />
      );
    }
    return (
      <TaskPage
        project={project}
        task={task}
        data={data}
        components={components}
        busy={busy}
        error={error}
        act={act}
      />
    );
  }
  if (route.name === "decisions") {
    return (
      <>
        <div className="sc-page-head">
          <h1 className="sc-page-title">Decisions</h1>
          <Button variant="primary" onClick={() => setAsking(true)} disabled={asking}>
            Raise a decision
          </Button>
        </div>
        {error !== undefined && <Callout tone="danger">{error}</Callout>}
        {asking && (
          <section className="sc-panel" aria-label="Raise a decision">
            <DecisionForm
              tasks={data.tasks}
              busy={busy}
              onSubmit={(input: RestDecisionInput) =>
                void act(async () => {
                  await data.actions.raiseDecision(input);
                  setAsking(false);
                })
              }
              onCancel={() => setAsking(false)}
            />
          </section>
        )}
        <components.DecisionList
          decisions={data.decisions}
          tasks={tasksById}
          taskHref={href}
          onAnswer={onAnswer}
          busy={busy}
          empty={
            <EmptyState
              title="Nothing waits for a person"
              body="A decision raised from a task, or from here, shows up on this page."
            />
          }
        />
      </>
    );
  }
  if (route.name === "feed") {
    return (
      <>
        <div className="sc-page-head">
          <h1 className="sc-page-title">What happened</h1>
        </div>
        <components.EventFeed
          events={data.events}
          href={(event) =>
            event.taskId === null ? undefined : taskHref(project.key, event.taskId)
          }
          empty={<EmptyState title="Nothing happened yet" />}
        />
      </>
    );
  }
  if (route.name === "skills") {
    return (
      <>
        <div className="sc-page-head">
          <h1 className="sc-page-title">Skills</h1>
        </div>
        <components.SkillList skills={data.skills} />
      </>
    );
  }
  if (route.name === "members") {
    const me = data.me?.person ?? undefined;
    return (
      <>
        <div className="sc-page-head">
          <h1 className="sc-page-title">Members</h1>
        </div>
        <p className="sc-lead">
          {project.visibility === "workspace"
            ? "Everyone of the workspace is a member of this project; those listed here are its owners and the people named besides. "
            : "Only those listed here are in this project. "}
          An owner configures the project; a member works on it. A workspace administrator is an
          owner of every project.
        </p>
        {error !== undefined && <Callout tone="danger">{error}</Callout>}
        <components.MemberList
          members={data.members}
          people={data.people}
          me={me}
          busy={busy}
          onAdd={owner ? (input) => void act(() => data.actions.addMember(input)) : undefined}
          onChangeRole={
            owner
              ? (member, role) =>
                  void act(() => data.actions.updateMember(member.person.id, { role }))
              : undefined
          }
          onRemove={
            owner
              ? (member) => void act(() => data.actions.removeMember(member.person.id))
              : undefined
          }
          empty={
            <EmptyState
              title="Nobody is listed"
              body={
                project.visibility === "workspace"
                  ? "Everyone of the workspace is in; the administrators own it."
                  : "The administrators own it until an owner is listed."
              }
            />
          }
        />
      </>
    );
  }
  if (route.name === "settings") {
    if (!owner) {
      return (
        <EmptyState
          title="Only an owner may change the project"
          body="Ask one of its owners, or a workspace administrator."
        />
      );
    }
    return (
      <>
        <div className="sc-page-head">
          <h1 className="sc-page-title">Settings</h1>
        </div>
        <p className="sc-lead">
          The key, <code>{project.key}</code>, is what paths and the command say, and does not
          change. The skills address names a repository served by SkillCDN; empty, the
          organization's skills are shown.
        </p>
        {error !== undefined && <Callout tone="danger">{error}</Callout>}
        <section className="sc-panel" aria-label="Project settings">
          <ProjectForm
            project={project}
            busy={busy}
            onSubmit={(input) =>
              void act(() => data.actions.updateProject(input as RestProjectPatch))
            }
          />
        </section>
      </>
    );
  }
  return <EmptyState title="There is nothing at this address" />;
}

function WorkspacePage(props: {
  readonly route: Route;
  readonly data: ConsoleData;
  readonly components: ConsoleComponents;
}) {
  const { route, data, components } = props;
  const [making, setMaking] = useState(false);
  const [fresh, setFresh] = useState<RestTokenCreated | undefined>(undefined);
  const { busy, error, act } = useAction();

  if (route.name === "people") {
    const me = data.me?.person ?? undefined;
    const administrator = me?.role === "admin";
    return (
      <>
        <div className="sc-page-head">
          <h1 className="sc-page-title">People</h1>
        </div>
        <p className="sc-lead">
          Everyone who has signed in. An administrator configures the workspace and says what each
          person is; a member works in the projects they are in. What a person may do, their agents
          may do.
        </p>
        {error !== undefined && <Callout tone="danger">{error}</Callout>}
        <components.PeopleList
          people={data.people}
          me={me}
          busy={busy}
          onChangeRole={
            administrator
              ? (person, role) => void act(() => data.actions.updatePerson(person.id, { role }))
              : undefined
          }
        />
      </>
    );
  }
  if (route.name === "tokens") {
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    return (
      <>
        <div className="sc-page-head">
          <h1 className="sc-page-title">Tokens</h1>
          <Button variant="primary" onClick={() => setMaking(true)} disabled={making}>
            Make a token
          </Button>
        </div>
        <p className="sc-lead">
          A token lets an agent, a script or a console of your own act as you on this board: what
          you may do, it may do. Make one per agent, name it after where it runs, and remove it when
          that is over.
        </p>
        {error !== undefined && <Callout tone="danger">{error}</Callout>}
        {fresh !== undefined && (
          <NewToken token={fresh.token} secret={fresh.secret} onDone={() => setFresh(undefined)} />
        )}
        {making && (
          <section className="sc-panel" aria-label="Make a token">
            <TokenForm
              busy={busy}
              onSubmit={(input) =>
                void act(async () => {
                  setFresh(await data.actions.createToken(input));
                  setMaking(false);
                })
              }
              onCancel={() => setMaking(false)}
            />
          </section>
        )}
        <components.TokenList
          tokens={data.tokens}
          busy={busy}
          onRevoke={(token) => void act(() => data.actions.revokeToken(token.id))}
          empty={
            <EmptyState
              title="No tokens yet"
              body="Make one for your agent, and it can work on this board as you."
            />
          }
        />
        <section className="sc-panel sc-connect" aria-label="Connecting an agent">
          <h2 className="sc-section-title">Connecting an agent</h2>
          <p>
            An agent works this board with the <code>console</code> command, which comes with the{" "}
            <code>@skillcdn/console</code> package. Install the package where the agent runs, sign
            the command in with a token made here, and say which project the directory works in:
          </p>
          <pre className="sc-code">
            npm install -g @skillcdn/console{"\n"}console login --url {origin}
            {"\n"}console use {"<project key>"}
          </pre>
          <p>
            It asks for the token and keeps it in your home directory, and your agent is you from
            then on: <code>console take</code> starts work on a task, <code>console report</code>,{" "}
            <code>console hand-in</code> and <code>console ask</code> say how it goes, and{" "}
            <code>console finish</code> ends the run. <code>console help</code> says the rest.
          </p>
        </section>
      </>
    );
  }
  return <EmptyState title="There is nothing at this address" />;
}

export function createConsole(config: ConsoleConfig = {}): ConsoleApp {
  const components: ConsoleComponents = { ...DEFAULT_COMPONENTS, ...config.components };
  const client = config.client ?? createClient({ baseUrl: config.baseUrl ?? "" });
  const fallbackTitle = config.title ?? "Console";

  function App(props: { readonly initialPath?: string | undefined }) {
    const { location, navigate } = useLocation(props.initialPath);
    const route = useMemo(() => matchRoute(location.pathname), [location.pathname]);
    const projectKey = projectOf(route);
    const data = useConsoleData(client, projectKey);
    const failure = signInFailureOf(location.search);
    const title = data.me?.workspace.name ?? fallbackTitle;

    useEffect(() => {
      if (typeof document !== "undefined") {
        document.title = data.project === undefined ? title : `${data.project.name} · ${title}`;
      }
    }, [title, data.project]);

    if (data.me === undefined) {
      return (
        <div className="sc-loading">
          {data.error === undefined ? (
            <Spinner label="Loading" />
          ) : (
            <Callout
              tone="danger"
              title="The console could not be reached"
              action={<Button onClick={data.reload}>Try again</Button>}
            >
              {data.error}
            </Callout>
          )}
        </div>
      );
    }
    if (data.me.person === null) {
      return (
        <components.SignIn
          title={title}
          providers={data.me.signIn}
          returnTo={withoutSignInParam(location.pathname, location.search)}
          failure={failure}
        />
      );
    }
    const project = data.project;
    const waiting = data.decisions.filter((decision) => decision.answer === null).length;
    const nav =
      projectKey === undefined
        ? [{ href: PATHS.projects, label: "Projects", current: route.name === "projects" }]
        : [
            {
              href: projectHref(projectKey),
              label: "Board",
              current: route.name === "board" || route.name === "task",
            },
            {
              href: projectHref(projectKey, "decisions"),
              label: "Decisions",
              current: route.name === "decisions",
              count: waiting,
            },
            {
              href: projectHref(projectKey, "feed"),
              label: "Feed",
              current: route.name === "feed",
            },
            {
              href: projectHref(projectKey, "skills"),
              label: "Skills",
              current: route.name === "skills",
            },
            {
              href: projectHref(projectKey, "members"),
              label: "Members",
              current: route.name === "members",
            },
            ...(project?.role === "owner"
              ? [
                  {
                    href: projectHref(projectKey, "settings"),
                    label: "Settings",
                    current: route.name === "settings",
                  },
                ]
              : []),
          ];
    nav.push(
      { href: PATHS.people, label: "People", current: route.name === "people" },
      { href: PATHS.tokens, label: "Tokens", current: route.name === "tokens" },
    );
    let page: React.ReactNode;
    if (!data.loaded) {
      page = (
        <div className="sc-loading">
          <Spinner label="Loading the workspace" />
        </div>
      );
    } else if (route.name === "projects") {
      page = <ProjectsPage data={data} components={components} navigate={navigate} />;
    } else if (projectKey === undefined) {
      page = <WorkspacePage route={route} data={data} components={components} />;
    } else if (data.projectError !== undefined) {
      page = (
        <EmptyState
          title="No such project"
          body="It may not exist, or it is not yours to see. The projects you may work in are on the front page."
          action={<Button onClick={() => navigate(PATHS.projects)}>Projects</Button>}
        />
      );
    } else if (!data.projectLoaded || project === undefined) {
      page = (
        <div className="sc-loading">
          <Spinner label="Loading the project" />
        </div>
      );
    } else {
      page = (
        <ProjectPage
          route={route}
          project={project}
          data={data}
          components={components}
          navigate={navigate}
        />
      );
    }
    return (
      <components.Shell
        title={title}
        project={
          projectKey === undefined
            ? undefined
            : { name: project?.name ?? projectKey, href: projectHref(projectKey) }
        }
        nav={nav}
        person={data.me.person}
        live={projectKey === undefined ? undefined : data.live}
        onNavigate={(href) => navigate(href)}
        onSignOut={() => void data.actions.signOut()}
      >
        {page}
      </components.Shell>
    );
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
