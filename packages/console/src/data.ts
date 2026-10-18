import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  type CommentInput,
  type ConsoleClient,
  type DocumentFilter,
  EVENT_KINDS,
  type FileUpload,
  LIST_LIMIT,
  type ProjectClient,
  type RestAnswerInput,
  type RestCategory,
  type RestCategoryInput,
  type RestCategoryPatch,
  type RestComment,
  type RestConnectRequest,
  type RestDecision,
  type RestDecisionInput,
  type RestDecisionPatch,
  type RestDocument,
  type RestDocumentInput,
  type RestDocuments,
  type RestEvent,
  type RestGoal,
  type RestGoalInput,
  type RestGoalPatch,
  type RestListing,
  type RestListingInput,
  type RestMe,
  type RestMember,
  type RestMemberInput,
  type RestMemberPatch,
  type RestMePatch,
  type RestOrganization,
  type RestPackConnect,
  type RestPackConnectStarted,
  type RestPerson,
  type RestPersonPatch,
  type RestPersonWork,
  type RestProject,
  type RestProjectInput,
  type RestProjectPatch,
  type RestProjectRules,
  type RestRules,
  type RestRulesInput,
  type RestRun,
  type RestSkills,
  type RestTask,
  type RestTaskInput,
  type RestTaskPatch,
  type RestTasks,
  type RestToken,
  type RestTokenCreated,
  type RestTokenInput,
  type RestTokens,
  type RestVersion,
  type RestVersions,
  type RestWork,
  type RestWorkspace,
  type RestWorkspacePackConnect,
  type RestWorkspacePatch,
  restEventSchema,
} from "./api.js";

// What the console shows, and how it stays current: the workspace (who is signed in, the
// projects, the people, the tokens) is loaded once; the project the page is on is loaded whole,
// its feed from the beginning, and from then on the project's stream says when something
// changed: on every event the lists are loaded again, which is the boring way to be right.

/** How many events the feed keeps on the page. */
const FEED_KEEP = 200;
/** How many pages of the feed are read at the start before the stream takes over. */
const FEED_MAX_PAGES = 20;
/** How long changes that arrive together are gathered before the lists are loaded once. */
const RELOAD_DELAY_MS = 150;

export interface ConsoleActions {
  /** Makes a project, whose owner the person becomes, with an image for its mark when one is given. */
  createProject(input: RestProjectInput, icon?: FileUpload): Promise<RestProject>;
  /** Changes the settings of the project the page is on; for an owner. */
  updateProject(patch: RestProjectPatch): Promise<RestProject>;
  /** Sets the image for the mark of the project the page is on, or takes it away; for an owner. */
  setProjectIcon(input: FileUpload): Promise<RestProject>;
  removeProjectIcon(): Promise<RestProject>;
  /** Sets the pack token of the project the page is on, or takes it away; for an owner (ADR-0028). */
  setPackToken(token: string): Promise<RestProject>;
  removePackToken(): Promise<RestProject>;
  /** Asks the deployment to connect the project's pack with a code a person approves (ADR-0036); for an owner. */
  connectPackToken(): Promise<RestPackConnectStarted>;
  /** How that connection stands; once connected, the project is the one answered. */
  packTokenConnection(signal?: AbortSignal): Promise<RestPackConnect>;
  cancelPackTokenConnection(): Promise<void>;
  addMember(input: RestMemberInput): Promise<RestMember>;
  updateMember(personId: string, patch: RestMemberPatch): Promise<RestMember>;
  removeMember(personId: string): Promise<void>;
  createTask(input: RestTaskInput): Promise<RestTask>;
  updateTask(id: string, patch: RestTaskPatch): Promise<RestTask>;
  /** One task by its id or its number, asked for by itself: a task put away is not among the board's. */
  fetchTask(ref: string, signal?: AbortSignal): Promise<RestTask>;
  /** Puts a done or dropped task away, or brings one back (ADR-0029). */
  archiveTask(id: string): Promise<RestTask>;
  restoreTask(id: string): Promise<RestTask>;
  /** Puts every done or dropped task of a goal away; for an owner. Answers how many went. */
  archiveGoalTasks(goalId: string): Promise<number>;
  /** A page of the tasks put away, newest first. */
  archivedTasks(
    page: { readonly limit: number; readonly offset: number },
    signal?: AbortSignal,
  ): Promise<RestTasks>;
  raiseDecision(input: RestDecisionInput): Promise<RestDecision>;
  answerDecision(id: string, input: RestAnswerInput): Promise<RestDecision>;
  /** Grows a decision's record: its context, or what followed. */
  updateDecision(id: string, patch: RestDecisionPatch): Promise<RestDecision>;
  /** Sets a goal on the roadmap of the project the page is on; for an owner. */
  createGoal(input: RestGoalInput): Promise<RestGoal>;
  updateGoal(id: string, patch: RestGoalPatch): Promise<RestGoal>;
  /** What is on the person's plate across their projects, read when the page asks. */
  work(signal?: AbortSignal): Promise<RestWork>;
  /** The categories tasks are sorted into: kept by an administrator. */
  createCategory(input: RestCategoryInput): Promise<RestCategory>;
  updateCategory(key: string, patch: RestCategoryPatch): Promise<RestCategory>;
  removeCategory(key: string): Promise<void>;
  /** The workspace's rules (ADR-0023), read when the page asks; written and put away by an administrator. */
  rules(signal?: AbortSignal): Promise<RestRules>;
  writeRules(input: RestRulesInput): Promise<RestRules>;
  archiveRules(): Promise<RestRules>;
  /** The rules that hold in the project the page is on: the workspace's, and what the project adds. */
  projectRules(signal?: AbortSignal): Promise<RestProjectRules>;
  /** A folder's pages and folders, or the pages a search finds, in the project the page is on. */
  documents(filter?: DocumentFilter, signal?: AbortSignal): Promise<RestDocuments>;
  document(path: string, signal?: AbortSignal): Promise<RestDocument>;
  writeDocument(path: string, input: RestDocumentInput): Promise<RestDocument>;
  archiveDocument(path: string): Promise<RestDocument>;
  restoreDocument(path: string): Promise<RestDocument>;
  documentVersions(path: string, signal?: AbortSignal): Promise<RestVersions>;
  documentVersion(path: string, number: number, signal?: AbortSignal): Promise<RestVersion>;
  attachDocumentFile(path: string, input: FileUpload): Promise<RestDocument>;
  /** Changes what a person is, or whether they are in; for an administrator. */
  updatePerson(id: string, patch: RestPersonPatch): Promise<RestPerson>;
  /** Lets a login in (ADR-0022); for an administrator. */
  createListing(input: RestListingInput): Promise<RestListing>;
  /** Takes a listing away that nobody signed in with; for an administrator. */
  removeListing(id: string): Promise<void>;
  /** Keeps the person's own choice of language (ADR-0012). */
  updateMe(patch: RestMePatch): Promise<RestMe>;
  /** Changes the workspace's settings (ADR-0035); for an administrator. `me` says them from then on. */
  updateWorkspace(patch: RestWorkspacePatch): Promise<RestWorkspace>;
  /** The workspace's SkillCDN token (ADR-0036), for an administrator: set, taken away, or connected with a code. */
  setWorkspacePackToken(token: string): Promise<RestWorkspace>;
  removeWorkspacePackToken(): Promise<RestWorkspace>;
  connectWorkspacePackToken(): Promise<RestPackConnectStarted>;
  workspacePackTokenConnection(signal?: AbortSignal): Promise<RestWorkspacePackConnect>;
  cancelWorkspacePackTokenConnection(): Promise<void>;
  /** One person of the workspace by their exact login, or nobody: what an owner lists someone the People page does not show by. */
  findPerson(login: string, signal?: AbortSignal): Promise<RestPerson | undefined>;
  /** Marks a run that will not come back as abandoned. */
  abandonRun(id: string): Promise<RestRun>;
  /** Everything that happened to one task of the project, oldest first. */
  taskHistory(taskId: string, signal?: AbortSignal): Promise<RestEvent[]>;
  /** The discussion on one task of the project, oldest first (ADR-0024). */
  taskComments(taskId: string, signal?: AbortSignal): Promise<RestComment[]>;
  /** A word in the discussion on a task, with the files put in it. */
  comment(taskId: string, input: CommentInput): Promise<RestComment>;
  /** Makes a token for whoever is signed in; the answer carries the secret, this once. */
  createToken(input: RestTokenInput): Promise<RestTokenCreated>;
  revokeToken(id: string): Promise<void>;
  /** What asks to connect under a code (ADR-0011), for the person who approves it. */
  connectRequest(code: string, signal?: AbortSignal): Promise<RestConnectRequest>;
  approveConnection(code: string, input: RestTokenInput): Promise<RestConnectRequest>;
  denyConnection(code: string): Promise<void>;
  /** Another person's plate: for an administrator, or an owner of a project they are in. */
  personWork(personId: string, signal?: AbortSignal): Promise<RestPersonWork>;
  /** The tokens of another person, and the way to take one away: for an administrator. */
  personTokens(personId: string, signal?: AbortSignal): Promise<RestTokens>;
  revokePersonToken(personId: string, tokenId: string): Promise<void>;
  signOut(): Promise<void>;
}

export interface ConsoleData {
  /** Who is signed in and what the board is called; `undefined` until the server has answered. */
  readonly me: RestMe | undefined;
  /** What went wrong asking who is signed in, for a person. */
  readonly error: string | undefined;
  /** True once the workspace has been loaded for the first time: the projects, the people, the tokens. */
  readonly loaded: boolean;
  /** The projects the person may see, by name. */
  readonly projects: readonly RestProject[];
  /** Everyone of the workspace, those in first, the deactivated last (ADR-0022). */
  readonly people: readonly RestPerson[];
  /** The logins let in that nobody has signed in with yet. */
  readonly listed: readonly RestListing[];
  /** The organization at the git host that says who is in, where the deployment names one. */
  readonly organization: RestOrganization | null;
  /** The categories tasks are sorted into, by name. */
  readonly categories: readonly RestCategory[];
  /** The tokens of whoever is signed in, newest first. */
  readonly tokens: readonly RestToken[];
  /** The project the page is on, once loaded; `undefined` while loading, or when the page is on none. */
  readonly project: RestProject | undefined;
  /** True once the project the page is on has been loaded; false while it loads, or when there is none. */
  readonly projectLoaded: boolean;
  /** Why the project could not be loaded: not one the person may see, for instance. */
  readonly projectError: string | undefined;
  /** Whether the project's stream of events is connected. */
  readonly live: boolean;
  readonly tasks: readonly RestTask[];
  readonly decisions: readonly RestDecision[];
  /** The roadmap of the project: its goals, the active first. */
  readonly goals: readonly RestGoal[];
  /** The runs of the project, newest first. */
  readonly runs: readonly RestRun[];
  /** The project's events, oldest first. */
  readonly events: readonly RestEvent[];
  /** Those listed in the project, by login. */
  readonly members: readonly RestMember[];
  /** The project's skills, as the console answered; `undefined` until it has. */
  readonly skills: RestSkills | undefined;
  readonly actions: ConsoleActions;
  /** Asks everything again, from who is signed in on. */
  reload(): void;
}

/** The whole feed of a project from the beginning, page by page, bounded. */
async function readFeed(
  client: ConsoleClient,
  key: string,
  signal: AbortSignal,
): Promise<RestEvent[]> {
  const events: RestEvent[] = [];
  let after = 0;
  for (let page = 0; page < FEED_MAX_PAGES; page += 1) {
    const result = await client.project(key).events(after, {}, signal);
    events.push(...result.items);
    after = result.items.at(-1)?.id ?? after;
    if (!result.more) {
      break;
    }
  }
  return events.slice(-FEED_KEEP);
}

/** How many pages of the current tasks are read before the board is shown as it stands. */
const TASKS_MAX_PAGES = 20;

/**
 * The current tasks of a project, whole: page after page while the server says there is more,
 * so that a board past one page loses nothing without a word; the tasks put away are not among
 * them (ADR-0029).
 */
async function readTasks(
  scope: ProjectClient,
  signal: AbortSignal | undefined,
): Promise<{ readonly items: RestTask[] }> {
  const items: RestTask[] = [];
  for (let page = 0; page < TASKS_MAX_PAGES; page += 1) {
    const result = await scope.tasks(
      { archived: false, limit: LIST_LIMIT, offset: page * LIST_LIMIT },
      signal,
    );
    items.push(...result.items);
    if (!result.more) {
      break;
    }
  }
  return { items };
}

/** How many pages of the decisions are read before the record is shown as it stands. */
const DECISIONS_MAX_PAGES = 20;

/**
 * The decisions of a project, whole: page after page while the server says there is more, so
 * that the record is read to its end and the pages turn it without asking again.
 */
async function readDecisions(
  scope: ProjectClient,
  signal: AbortSignal | undefined,
): Promise<{ readonly items: RestDecision[] }> {
  const items: RestDecision[] = [];
  for (let page = 0; page < DECISIONS_MAX_PAGES; page += 1) {
    const result = await scope.decisions({ limit: LIST_LIMIT, offset: page * LIST_LIMIT }, signal);
    items.push(...result.items);
    if (!result.more) {
      break;
    }
  }
  return { items };
}

const wordsOf = (failure: unknown, fallback: string): string =>
  failure instanceof ApiError ? failure.message : fallback;

/**
 * The data of the console: the workspace, and the project `projectKey` names, kept current.
 * A composition of its own calls this with the key of the project its page is on, or none.
 */
export function useConsoleData(client: ConsoleClient, projectKey: string | undefined): ConsoleData {
  const [me, setMe] = useState<RestMe | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const [projects, setProjects] = useState<readonly RestProject[]>([]);
  const [people, setPeople] = useState<readonly RestPerson[]>([]);
  const [listed, setListed] = useState<readonly RestListing[]>([]);
  const [organization, setOrganization] = useState<RestOrganization | null>(null);
  const [categories, setCategories] = useState<readonly RestCategory[]>([]);
  const [tokens, setTokens] = useState<readonly RestToken[]>([]);
  const [project, setProject] = useState<RestProject | undefined>(undefined);
  const [projectLoaded, setProjectLoaded] = useState(false);
  const [projectError, setProjectError] = useState<string | undefined>(undefined);
  const [live, setLive] = useState(false);
  const [tasks, setTasks] = useState<readonly RestTask[]>([]);
  const [decisions, setDecisions] = useState<readonly RestDecision[]>([]);
  const [goals, setGoals] = useState<readonly RestGoal[]>([]);
  const [runs, setRuns] = useState<readonly RestRun[]>([]);
  const [events, setEvents] = useState<readonly RestEvent[]>([]);
  const [members, setMembers] = useState<readonly RestMember[]>([]);
  const [skills, setSkills] = useState<RestSkills | undefined>(undefined);
  const [generation, setGeneration] = useState(0);
  const lastEvent = useRef(0);
  const signedIn = me?.person !== null && me !== undefined;

  const reload = useCallback(() => setGeneration((current) => current + 1), []);

  /** Loads the workspace's lists again. What fails stays as it was. */
  const refreshWorkspace = useCallback(
    async (signal?: AbortSignal) => {
      const [nextProjects, nextPeople, nextCategories] = await Promise.all([
        client.projects(signal),
        client.people(signal),
        client.categories(signal),
      ]);
      if (signal?.aborted === true) {
        return;
      }
      setProjects(nextProjects.items);
      setPeople(nextPeople.items);
      setListed(nextPeople.listed);
      setOrganization(nextPeople.organization);
      setCategories(nextCategories.items);
    },
    [client],
  );

  /** Loads the project's lists again. What fails stays as it was; the next event asks again. */
  const refreshProject = useCallback(
    async (signal?: AbortSignal) => {
      if (projectKey === undefined) {
        return;
      }
      const scope = client.project(projectKey);
      const [nextProject, nextTasks, nextDecisions, nextGoals, nextRuns, nextMembers] =
        await Promise.all([
          scope.get(signal),
          readTasks(scope, signal),
          readDecisions(scope, signal),
          scope.goals({}, signal),
          scope.runs(undefined, signal),
          scope.members(signal),
        ]);
      if (signal?.aborted === true) {
        return;
      }
      setProject(nextProject);
      setTasks(nextTasks.items);
      setDecisions(nextDecisions.items);
      setGoals(nextGoals.items);
      setRuns(nextRuns.items);
      setMembers(nextMembers.items);
    },
    [client, projectKey],
  );

  // Who is signed in, then the workspace: the projects, the people, the person's tokens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `generation` is the trigger
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setError(undefined);
    const run = async () => {
      let answer: RestMe;
      try {
        answer = await client.me(signal);
      } catch (failure) {
        if (!signal.aborted) {
          setError(wordsOf(failure, "The server could not be reached."));
        }
        return;
      }
      if (signal.aborted) {
        return;
      }
      setMe(answer);
      if (answer.person === null) {
        setLoaded(false);
        return;
      }
      try {
        const [, mine] = await Promise.all([
          refreshWorkspace(signal),
          // A token cannot list tokens: a console that holds one has none to show.
          answer.agent === null ? client.tokens(signal) : Promise.resolve({ items: [] }),
        ]);
        if (signal.aborted) {
          return;
        }
        setTokens(mine.items);
        setLoaded(true);
      } catch (failure) {
        if (!signal.aborted) {
          setError(wordsOf(failure, "The workspace could not be loaded."));
        }
      }
    };
    void run();
    return () => controller.abort();
  }, [client, generation, refreshWorkspace]);

  // The project the page is on: its lists, its feed from the beginning, and its stream from
  // where the feed ends. Another project, or none, starts over.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `generation` is the trigger
  useEffect(() => {
    setProject(undefined);
    setProjectLoaded(false);
    setProjectError(undefined);
    setTasks([]);
    setDecisions([]);
    setGoals([]);
    setRuns([]);
    setEvents([]);
    setMembers([]);
    setSkills(undefined);
    setLive(false);
    if (projectKey === undefined || !signedIn) {
      return;
    }
    const controller = new AbortController();
    const { signal } = controller;
    let source: EventSource | undefined;
    let reloadTimer: ReturnType<typeof setTimeout> | undefined;
    const scope = client.project(projectKey);
    const run = async () => {
      try {
        const [, feed] = await Promise.all([
          refreshProject(signal),
          readFeed(client, projectKey, signal),
        ]);
        if (signal.aborted) {
          return;
        }
        setEvents(feed);
        lastEvent.current = feed.at(-1)?.id ?? 0;
        setProjectLoaded(true);
      } catch (failure) {
        if (!signal.aborted) {
          setProjectError(wordsOf(failure, "The project could not be loaded."));
        }
        return;
      }
      // The skills are someone else's to serve: asked for on their own, so that the board
      // stands without them.
      scope
        .skills(signal)
        .then((answer) => {
          if (!signal.aborted) {
            setSkills(answer);
          }
        })
        .catch(() => {
          // No answer at all is said on the page as the deployment being out of reach,
          // rather than waited for.
          if (!signal.aborted) {
            setSkills({
              address: null,
              source: "",
              page: null,
              status: "unavailable",
              refusal: null,
              items: [],
              mount: null,
            });
          }
        });
      if (typeof EventSource === "undefined") {
        return;
      }
      source = new EventSource(scope.eventStreamUrl(lastEvent.current));
      source.onopen = () => setLive(true);
      source.onerror = () => setLive(false);
      const arrived = (message: MessageEvent) => {
        const parsed = restEventSchema.safeParse(JSON.parse(String(message.data)));
        if (!parsed.success || parsed.data.id <= lastEvent.current) {
          return;
        }
        lastEvent.current = parsed.data.id;
        const event = parsed.data;
        setEvents((current) => [...current, event].slice(-FEED_KEEP));
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => {
          refreshProject(signal).catch(() => undefined);
          if (event.kind.startsWith("project.")) {
            refreshWorkspace(signal).catch(() => undefined);
          }
        }, RELOAD_DELAY_MS);
      };
      for (const kind of EVENT_KINDS) {
        source.addEventListener(kind, arrived);
      }
    };
    void run();
    return () => {
      controller.abort();
      clearTimeout(reloadTimer);
      source?.close();
      setLive(false);
    };
  }, [client, projectKey, signedIn, generation, refreshProject, refreshWorkspace]);

  const actions = useMemo<ConsoleActions>(() => {
    /** The project the page is on, for an action that needs one. */
    const scope = () => {
      if (projectKey === undefined) {
        throw new ApiError(0, "no_project", "The page is on no project.");
      }
      return client.project(projectKey);
    };
    return {
      async createProject(input, icon) {
        const made = await client.createProject(input);
        const marked = icon === undefined ? made : await client.project(made.key).setIcon(icon);
        await refreshWorkspace();
        return marked;
      },
      async updateProject(patch) {
        const changed = await scope().update(patch);
        setProject(changed);
        await refreshWorkspace();
        return changed;
      },
      async setProjectIcon(input) {
        const changed = await scope().setIcon(input);
        setProject(changed);
        await refreshWorkspace();
        return changed;
      },
      async removeProjectIcon() {
        const changed = await scope().removeIcon();
        setProject(changed);
        await refreshWorkspace();
        return changed;
      },
      async setPackToken(token) {
        const changed = await scope().setPackToken({ token });
        setProject(changed);
        return changed;
      },
      async removePackToken() {
        const changed = await scope().removePackToken();
        setProject(changed);
        return changed;
      },
      connectPackToken: () => scope().connectPackToken(),
      async packTokenConnection(signal) {
        const state = await scope().packTokenConnection(signal);
        if (state.status === "connected") {
          setProject(state.project);
        }
        return state;
      },
      cancelPackTokenConnection: () => scope().cancelPackTokenConnection(),
      async addMember(input) {
        const member = await scope().addMember(input);
        await refreshProject();
        return member;
      },
      async updateMember(personId, patch) {
        const member = await scope().updateMember(personId, patch);
        await refreshProject();
        return member;
      },
      async removeMember(personId) {
        await scope().removeMember(personId);
        await refreshProject();
      },
      async createTask(input) {
        const task = await scope().createTask(input);
        await refreshProject();
        return task;
      },
      async updateTask(id, patch) {
        const task = await scope().updateTask(id, patch);
        setTasks((current) => current.map((candidate) => (candidate.id === id ? task : candidate)));
        return task;
      },
      fetchTask: (ref, signal) => scope().task(ref, signal),
      async archiveTask(id) {
        const task = await scope().archiveTask(id);
        setTasks((current) => current.filter((candidate) => candidate.id !== id));
        return task;
      },
      async restoreTask(id) {
        const task = await scope().restoreTask(id);
        setTasks((current) => [task, ...current.filter((candidate) => candidate.id !== id)]);
        return task;
      },
      async archiveGoalTasks(goalId) {
        const { archived } = await scope().archiveTasksOfGoal(goalId);
        await refreshProject();
        return archived;
      },
      archivedTasks: (page, signal) => scope().tasks({ archived: true, ...page }, signal),
      async raiseDecision(input) {
        const decision = await scope().raiseDecision(input);
        await refreshProject();
        return decision;
      },
      async answerDecision(id, input) {
        const decision = await scope().answerDecision(id, input);
        await refreshProject();
        return decision;
      },
      async updateDecision(id, patch) {
        const decision = await scope().updateDecision(id, patch);
        setDecisions((current) =>
          current.map((candidate) => (candidate.id === id ? decision : candidate)),
        );
        return decision;
      },
      async createGoal(input) {
        const goal = await scope().createGoal(input);
        await refreshProject();
        return goal;
      },
      async updateGoal(id, patch) {
        const goal = await scope().updateGoal(id, patch);
        setGoals((current) => current.map((candidate) => (candidate.id === id ? goal : candidate)));
        return goal;
      },
      work: (signal) => client.work(signal),
      async createCategory(input) {
        const category = await client.createCategory(input);
        setCategories((await client.categories()).items);
        return category;
      },
      async updateCategory(key, patch) {
        const category = await client.updateCategory(key, patch);
        setCategories((await client.categories()).items);
        return category;
      },
      async removeCategory(key) {
        await client.removeCategory(key);
        setCategories((current) => current.filter((category) => category.key !== key));
      },
      documents: (filter, signal) => scope().documents(filter, signal),
      document: (path, signal) => scope().document(path, signal),
      writeDocument: (path, input) => scope().writeDocument(path, input),
      archiveDocument: (path) => scope().archiveDocument(path),
      restoreDocument: (path) => scope().restoreDocument(path),
      documentVersions: (path, signal) => scope().documentVersions(path, signal),
      documentVersion: (path, number, signal) => scope().documentVersion(path, number, signal),
      attachDocumentFile: (path, input) => scope().attachFile(path, input),
      async updatePerson(id, patch) {
        const person = await client.updatePerson(id, patch);
        setMe((current) => (current?.person?.id === id ? { ...current, person } : current));
        await refreshWorkspace();
        return person;
      },
      async createListing(input) {
        const listing = await client.createListing(input);
        await refreshWorkspace();
        return listing;
      },
      async removeListing(id) {
        await client.removeListing(id);
        await refreshWorkspace();
      },
      async updateMe(patch) {
        const answer = await client.updateMe(patch);
        setMe(answer);
        return answer;
      },
      async updateWorkspace(patch) {
        const workspace = await client.updateWorkspace(patch);
        setMe((current) => (current === undefined ? undefined : { ...current, workspace }));
        // The member visibility may have changed: the people are read again under the new setting.
        await refreshWorkspace();
        return workspace;
      },
      async setWorkspacePackToken(token) {
        const workspace = await client.setWorkspacePackToken({ token });
        setMe((current) => (current === undefined ? undefined : { ...current, workspace }));
        return workspace;
      },
      async removeWorkspacePackToken() {
        const workspace = await client.removeWorkspacePackToken();
        setMe((current) => (current === undefined ? undefined : { ...current, workspace }));
        return workspace;
      },
      connectWorkspacePackToken: () => client.connectWorkspacePackToken(),
      async workspacePackTokenConnection(signal) {
        const state = await client.workspacePackTokenConnection(signal);
        if (state.status === "connected") {
          const { workspace } = state;
          setMe((current) => (current === undefined ? undefined : { ...current, workspace }));
        }
        return state;
      },
      cancelWorkspacePackTokenConnection: () => client.cancelWorkspacePackTokenConnection(),
      findPerson: (login, signal) => client.findPerson(login, signal),
      async abandonRun(id) {
        const run = await scope().endRun(id, { status: "abandoned" });
        await refreshProject();
        return run;
      },
      async taskHistory(taskId, signal) {
        const history: RestEvent[] = [];
        let after = 0;
        for (let page = 0; page < FEED_MAX_PAGES; page += 1) {
          const result = await scope().events(after, { task: taskId }, signal);
          history.push(...result.items);
          after = result.items.at(-1)?.id ?? after;
          if (!result.more) {
            break;
          }
        }
        return history;
      },
      taskComments: async (taskId, signal) => (await scope().comments(taskId, signal)).items,
      comment: (taskId, input) => scope().comment(taskId, input),
      async createToken(input) {
        const made = await client.createToken(input);
        setTokens((await client.tokens()).items);
        return made;
      },
      async revokeToken(id) {
        await client.revokeToken(id);
        setTokens((current) => current.filter((token) => token.id !== id));
      },
      rules: (signal) => client.rules(signal),
      writeRules: (input) => client.writeRules(input),
      archiveRules: () => client.archiveRules(),
      projectRules: (signal) => scope().rules(signal),
      connectRequest: (code, signal) => client.connectRequest(code, signal),
      approveConnection: (code, input) => client.approveConnection(code, input),
      denyConnection: (code) => client.denyConnection(code),
      personWork: (personId, signal) => client.personWork(personId, signal),
      personTokens: (personId, signal) => client.personTokens(personId, signal),
      revokePersonToken: (personId, tokenId) => client.revokePersonToken(personId, tokenId),
      async signOut() {
        await client.signOut();
        setMe((current) => (current === undefined ? undefined : { ...current, person: null }));
        setLoaded(false);
      },
    };
  }, [client, projectKey, refreshProject, refreshWorkspace]);

  return {
    me,
    error,
    loaded,
    projects,
    people,
    listed,
    organization,
    categories,
    tokens,
    project,
    projectLoaded,
    projectError,
    live,
    tasks,
    decisions,
    goals,
    runs,
    events,
    members,
    skills,
    actions,
    reload,
  };
}
