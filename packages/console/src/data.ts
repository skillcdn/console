import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  type ConsoleClient,
  type DocumentFilter,
  EVENT_KINDS,
  type FileUpload,
  type RestAnswerInput,
  type RestConnectRequest,
  type RestDecision,
  type RestDecisionInput,
  type RestDecisionPatch,
  type RestDocument,
  type RestDocumentInput,
  type RestDocuments,
  type RestEvent,
  type RestMe,
  type RestMember,
  type RestMemberInput,
  type RestMemberPatch,
  type RestMePatch,
  type RestPerson,
  type RestPersonPatch,
  type RestProject,
  type RestProjectInput,
  type RestProjectPatch,
  type RestRun,
  type RestSkills,
  type RestTask,
  type RestTaskInput,
  type RestTaskPatch,
  type RestToken,
  type RestTokenCreated,
  type RestTokenInput,
  type RestTokens,
  type RestVersion,
  type RestVersions,
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
  /** Makes a project, whose owner the person becomes. */
  createProject(input: RestProjectInput): Promise<RestProject>;
  /** Changes the settings of the project the page is on; for an owner. */
  updateProject(patch: RestProjectPatch): Promise<RestProject>;
  addMember(input: RestMemberInput): Promise<RestMember>;
  updateMember(personId: string, patch: RestMemberPatch): Promise<RestMember>;
  removeMember(personId: string): Promise<void>;
  createTask(input: RestTaskInput): Promise<RestTask>;
  updateTask(id: string, patch: RestTaskPatch): Promise<RestTask>;
  raiseDecision(input: RestDecisionInput): Promise<RestDecision>;
  answerDecision(id: string, input: RestAnswerInput): Promise<RestDecision>;
  /** Grows a decision's record: its context, or what followed. */
  updateDecision(id: string, patch: RestDecisionPatch): Promise<RestDecision>;
  /** A folder's pages and folders, or the pages a search finds, in the project the page is on. */
  documents(filter?: DocumentFilter, signal?: AbortSignal): Promise<RestDocuments>;
  document(path: string, signal?: AbortSignal): Promise<RestDocument>;
  writeDocument(path: string, input: RestDocumentInput): Promise<RestDocument>;
  archiveDocument(path: string): Promise<RestDocument>;
  restoreDocument(path: string): Promise<RestDocument>;
  documentVersions(path: string, signal?: AbortSignal): Promise<RestVersions>;
  documentVersion(path: string, number: number, signal?: AbortSignal): Promise<RestVersion>;
  attachDocumentFile(path: string, input: FileUpload): Promise<RestDocument>;
  /** Changes what a person is; for an administrator. */
  updatePerson(id: string, patch: RestPersonPatch): Promise<RestPerson>;
  /** Keeps the person's own choice of language (ADR-0012). */
  updateMe(patch: RestMePatch): Promise<RestMe>;
  /** Marks a run that will not come back as abandoned. */
  abandonRun(id: string): Promise<RestRun>;
  /** Everything that happened to one task of the project, oldest first. */
  taskHistory(taskId: string, signal?: AbortSignal): Promise<RestEvent[]>;
  /** Makes a token for whoever is signed in; the answer carries the secret, this once. */
  createToken(input: RestTokenInput): Promise<RestTokenCreated>;
  revokeToken(id: string): Promise<void>;
  /** What asks to connect under a code (ADR-0011), for the person who approves it. */
  connectRequest(code: string, signal?: AbortSignal): Promise<RestConnectRequest>;
  approveConnection(code: string, input: RestTokenInput): Promise<RestConnectRequest>;
  denyConnection(code: string): Promise<void>;
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
  readonly people: readonly RestPerson[];
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
  const [tokens, setTokens] = useState<readonly RestToken[]>([]);
  const [project, setProject] = useState<RestProject | undefined>(undefined);
  const [projectLoaded, setProjectLoaded] = useState(false);
  const [projectError, setProjectError] = useState<string | undefined>(undefined);
  const [live, setLive] = useState(false);
  const [tasks, setTasks] = useState<readonly RestTask[]>([]);
  const [decisions, setDecisions] = useState<readonly RestDecision[]>([]);
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
      const [nextProjects, nextPeople] = await Promise.all([
        client.projects(signal),
        client.people(signal),
      ]);
      if (signal?.aborted === true) {
        return;
      }
      setProjects(nextProjects.items);
      setPeople(nextPeople.items);
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
      const [nextProject, nextTasks, nextDecisions, nextRuns, nextMembers] = await Promise.all([
        scope.get(signal),
        scope.tasks(undefined, signal),
        scope.decisions(undefined, signal),
        scope.runs(undefined, signal),
        scope.members(signal),
      ]);
      if (signal?.aborted === true) {
        return;
      }
      setProject(nextProject);
      setTasks(nextTasks.items);
      setDecisions(nextDecisions.items);
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
        const [, mine] = await Promise.all([refreshWorkspace(signal), client.tokens(signal)]);
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
        .catch(() => undefined);
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
      async createProject(input) {
        const made = await client.createProject(input);
        await refreshWorkspace();
        return made;
      },
      async updateProject(patch) {
        const changed = await scope().update(patch);
        setProject(changed);
        await refreshWorkspace();
        return changed;
      },
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
      async updateMe(patch) {
        const answer = await client.updateMe(patch);
        setMe(answer);
        return answer;
      },
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
      async createToken(input) {
        const made = await client.createToken(input);
        setTokens((await client.tokens()).items);
        return made;
      },
      async revokeToken(id) {
        await client.revokeToken(id);
        setTokens((current) => current.filter((token) => token.id !== id));
      },
      connectRequest: (code, signal) => client.connectRequest(code, signal),
      approveConnection: (code, input) => client.approveConnection(code, input),
      denyConnection: (code) => client.denyConnection(code),
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
    tokens,
    project,
    projectLoaded,
    projectError,
    live,
    tasks,
    decisions,
    runs,
    events,
    members,
    skills,
    actions,
    reload,
  };
}
