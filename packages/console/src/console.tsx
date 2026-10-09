import { type ComponentType, StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  ApiError,
  type ConsoleClient,
  createClient,
  type RestAnswerInput,
  type RestDecision,
  type RestDecisionInput,
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
import { Shell, type ShellProps } from "./components/shell.js";
import { SignIn, type SignInProps } from "./components/sign-in.js";
import { TaskForm } from "./components/task-form.js";
import { TaskView, type TaskViewProps } from "./components/task-view.js";
import { NewToken, TokenForm, TokenList, type TokenListProps } from "./components/tokens.js";
import { Button, Callout, EmptyState, Spinner } from "./components/ui.js";
import { type ConsoleData, useConsoleData } from "./data.js";
import {
  matchRoute,
  PATHS,
  type Route,
  signInFailureOf,
  taskHref,
  withoutSignInParam,
} from "./router.js";

// The composition of the default console: the pages assembled from the components, with the
// places a team may replace named. The UI the image serves is this, with the default config.

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

function Page(props: {
  readonly route: Route;
  readonly data: ConsoleData;
  readonly components: ConsoleComponents;
  readonly navigate: (href: string) => void;
}) {
  const { route, data, components, navigate } = props;
  const [writing, setWriting] = useState(false);
  const [asking, setAsking] = useState(false);
  const [making, setMaking] = useState(false);
  const [fresh, setFresh] = useState<RestTokenCreated | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const tasksById = useMemo(() => new Map(data.tasks.map((task) => [task.id, task])), [data.tasks]);
  const href = (task: RestTask) => taskHref(task.id);

  /** Runs a change, shows what went wrong, and refreshes what it touched. */
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
  const onMove = (task: RestTask, state: TaskState) =>
    void act(() => data.actions.updateTask(task.id, { state }));
  const onChange = (task: RestTask, patch: RestTaskInput) =>
    void act(() => data.actions.updateTask(task.id, patch));
  const onAnswer = (decision: RestDecision, input: RestAnswerInput) =>
    void act(() => data.actions.answerDecision(decision.id, input));
  const onRaise = (input: RestDecisionInput) => void act(() => data.actions.raiseDecision(input));

  if (route.name === "board") {
    return (
      <>
        <div className="sc-page-head">
          <h1 className="sc-page-title">Board</h1>
          <Button variant="primary" onClick={() => setWriting(true)} disabled={writing}>
            Write a task
          </Button>
        </div>
        {error !== undefined && <Callout tone="danger">{error}</Callout>}
        {writing && (
          <section className="sc-panel" aria-label="Write a task">
            <TaskForm
              people={data.people}
              parents={data.tasks}
              busy={busy}
              onSubmit={(input) =>
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
          body="It may have been written on another board, or the link is wrong."
        />
      );
    }
    return (
      <components.TaskView
        task={task}
        people={data.people}
        tasks={data.tasks}
        decisions={data.decisions}
        taskHref={href}
        busy={busy}
        error={error}
        onChange={onChange}
        onMove={onMove}
        onRaiseDecision={onRaise}
        onAnswer={onAnswer}
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
              onSubmit={(input) =>
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
          href={(event) => (event.taskId === null ? undefined : taskHref(event.taskId))}
          empty={<EmptyState title="Nothing happened yet" />}
        />
      </>
    );
  }
  if (route.name === "people") {
    const me = data.me?.person ?? undefined;
    const administrator = me?.role === "admin";
    return (
      <>
        <div className="sc-page-head">
          <h1 className="sc-page-title">People</h1>
        </div>
        <p className="sc-lead">
          Everyone who has signed in. An administrator configures the board and says what each
          person is; a member works on it. What a person may do, their agents may do.
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
    const data = useConsoleData(client);
    const route = useMemo(() => matchRoute(location.pathname), [location.pathname]);
    const failure = signInFailureOf(location.search);
    const title = data.me?.workspace.name ?? fallbackTitle;

    useEffect(() => {
      if (typeof document !== "undefined") {
        document.title = title;
      }
    }, [title]);

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
    const waiting = data.decisions.filter((decision) => decision.answer === null).length;
    const nav = [
      {
        href: PATHS.board,
        label: "Board",
        current: route.name === "board" || route.name === "task",
      },
      {
        href: PATHS.decisions,
        label: "Decisions",
        current: route.name === "decisions",
        count: waiting,
      },
      { href: PATHS.feed, label: "Feed", current: route.name === "feed" },
      { href: PATHS.people, label: "People", current: route.name === "people" },
      { href: PATHS.tokens, label: "Tokens", current: route.name === "tokens" },
    ];
    return (
      <components.Shell
        title={title}
        nav={nav}
        person={data.me.person}
        live={data.live}
        onNavigate={(href) => navigate(href)}
        onSignOut={() => void data.actions.signOut()}
      >
        {data.loaded ? (
          <Page route={route} data={data} components={components} navigate={navigate} />
        ) : (
          <div className="sc-loading">
            <Spinner label="Loading the board" />
          </div>
        )}
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
