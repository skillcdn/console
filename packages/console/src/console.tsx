import { type ComponentType, StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  type ConsoleClient,
  createClient,
  type RestAnswerInput,
  type RestDecision,
  type RestDecisionInput,
  type RestDecisionPatch,
  type RestEvent,
  type RestProject,
  type RestProjectInput,
  type RestProjectPatch,
  type RestTask,
  type RestTaskInput,
  type RestToken,
  type RestTokenCreated,
  type TaskState,
} from "./api.js";
import { Board, type BoardProps } from "./components/board.js";
import { ConnectWords } from "./components/connect.js";
import { DecisionForm } from "./components/decision-form.js";
import { DecisionCard, DecisionList, type DecisionListProps } from "./components/decision-list.js";
import { EventFeed, type EventFeedProps } from "./components/event-feed.js";
import { PeopleList, type PeopleListProps } from "./components/people.js";
import {
  MemberList,
  type MemberListProps,
  ProjectForm,
  ProjectList,
  type ProjectListProps,
} from "./components/projects.js";
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
import { TaskView, type TaskViewProps } from "./components/task-view.js";
import { NewToken, TokenForm, TokenList, type TokenListProps } from "./components/tokens.js";
import { Button, Callout, EmptyState, Spinner } from "./components/ui.js";
import { ConnectPage } from "./connect-page.js";
import { type ConsoleData, useConsoleData } from "./data.js";
import { DocsPage } from "./docs-page.js";
import {
  chooseLanguage,
  DEFAULT_LANGUAGES,
  LanguageContext,
  type LanguagePack,
  useWords,
} from "./i18n/index.js";
import {
  decisionHref,
  docHref,
  matchRoute,
  type Navigation,
  newDecisionHref,
  newTaskHref,
  PATHS,
  personAgentsHref,
  projectHref,
  type Route,
  signInFailureOf,
  taskHref,
  withoutSignInParam,
} from "./router.js";
import { projectPath } from "./routes.js";
import { useAction } from "./use-action.js";

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
  /** The languages the pages speak, the first being the one spoken when nothing else decides; the package's when left out. */
  readonly languages?: readonly LanguagePack[] | undefined;
  /** The marks beside the name (ADR-0013); none shows the name alone. A custom console brings its own. */
  readonly brand?: Brand | undefined;
  /** The client to talk to the server with; made from `baseUrl` when left out. For tests. */
  readonly client?: ConsoleClient | undefined;
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
      <p className="sc-lead">{words.lead}</p>
      {error !== undefined && <Callout tone="danger">{error}</Callout>}
      {making && (
        <section className="sc-panel" aria-label={words.form.aria}>
          <ProjectForm
            busy={busy}
            onSubmit={(input) =>
              void act(async () => {
                const made = await data.actions.createProject(input as RestProjectInput);
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
  const task =
    route.number === undefined
      ? data.tasks.find((candidate) => candidate.id === route.id)
      : data.tasks.find((candidate) => candidate.number === route.number);
  const [history, setHistory] = useState<readonly RestEvent[] | undefined>(undefined);
  const { taskHistory } = data.actions;
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
    return () => controller.abort();
  }, [taskId, taskHistory, feedLength]);
  if (task === undefined) {
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
      people={data.people}
      tasks={data.tasks}
      decisions={data.decisions}
      runs={data.runs}
      history={history}
      taskHref={(candidate) => taskHref(key, candidate.number)}
      decisionHref={(decisionId) => decisionHref(key, decisionId)}
      fileHref={(artifact) => projectPath(key, "files", artifact.id)}
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
    return (
      <>
        <div className="sc-page-head">
          <h1 className="sc-page-title">{project.name}</h1>
          <LinkButton href={newTaskHref(key)} variant="primary">
            {words.board.writeTask}
          </LinkButton>
        </div>
        {project.description.length > 0 && <p className="sc-lead">{project.description}</p>}
        {error !== undefined && <Callout tone="danger">{error}</Callout>}
        <components.Board
          tasks={data.tasks}
          taskHref={href}
          onOpen={(task) => navigation.go(href(task))}
          onMove={onMove}
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
        <section className="sc-panel" aria-label={words.task.newAria}>
          <TaskForm
            people={data.people}
            parents={data.tasks}
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
        <section className="sc-panel" aria-label={words.decisions.raiseAria}>
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
    const members = words.projects.members;
    return (
      <>
        <div className="sc-page-head">
          <h1 className="sc-page-title">{members.title}</h1>
        </div>
        <p className="sc-lead">
          {project.visibility === "workspace" ? members.leadWorkspace : members.leadPrivate}{" "}
          {members.leadRoles}
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
    const settings = words.projects.settings;
    if (!owner) {
      return <EmptyState title={settings.onlyOwner.title} body={settings.onlyOwner.body} />;
    }
    return (
      <>
        <div className="sc-page-head">
          <h1 className="sc-page-title">{settings.title}</h1>
        </div>
        <p className="sc-lead">
          {settings.leadBefore}
          <code>{project.key}</code>
          {settings.leadAfter}
        </p>
        {error !== undefined && <Callout tone="danger">{error}</Callout>}
        <section className="sc-panel" aria-label={settings.aria}>
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
  return <NothingHere />;
}

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
        <h1 className="sc-page-title">{words.people.agentsOf(person?.login ?? "?")}</h1>
        <LinkButton href={PATHS.people}>{words.nav.people}</LinkButton>
      </div>
      <p className="sc-lead">
        {words.people.agentsLead(person?.name ?? person?.login ?? words.feed.someone)}
      </p>
      {error !== undefined && <Callout tone="danger">{error}</Callout>}
      {tokens === undefined ? (
        <div className="sc-loading">
          <Spinner label={words.people.loadingAgents} />
        </div>
      ) : (
        <components.TokenList
          tokens={tokens}
          busy={busy}
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

  if (route.name === "people") {
    const me = data.me?.person ?? undefined;
    const administrator = me?.role === "admin";
    return (
      <>
        <div className="sc-page-head">
          <h1 className="sc-page-title">{words.people.title}</h1>
        </div>
        <p className="sc-lead">{words.people.lead}</p>
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
        <p className="sc-lead">{agents.lead}</p>
        {error !== undefined && <Callout tone="danger">{error}</Callout>}
        {fresh !== undefined && (
          <NewToken token={fresh.token} secret={fresh.secret} onDone={() => setFresh(undefined)} />
        )}
        {making && (
          <section className="sc-panel" aria-label={agents.makeAria}>
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
        {
          href: PATHS.people,
          label: words.nav.people,
          current: route.name === "people" || route.name === "person-agents",
        },
        {
          href: PATHS.agents,
          label: words.nav.agents,
          current: route.name === "agents" || route.name === "new-token",
        },
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
              ...(project?.role === "owner"
                ? [
                    {
                      href: projectHref(projectKey, "settings"),
                      label: words.nav.settings,
                      current: route.name === "settings",
                    },
                  ]
                : []),
            ];
      let page: React.ReactNode;
      if (!data.loaded || route.name === "moved") {
        page = (
          <div className="sc-loading">
            <Spinner label={words.common.loadingWorkspace} />
          </div>
        );
      } else if (route.name === "projects" || route.name === "new-project") {
        page = (
          <ProjectsPage
            data={data}
            components={components}
            navigation={navigation}
            making={route.name === "new-project"}
          />
        );
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
              : { name: project?.name ?? projectKey, href: projectHref(projectKey) }
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
          onNavigate={(href) => navigation.go(href)}
          onSignOut={() => void data.actions.signOut()}
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
