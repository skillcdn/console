import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  type ConsoleClient,
  type RestAnswerInput,
  type RestDecision,
  type RestDecisionInput,
  type RestEvent,
  type RestMe,
  type RestPerson,
  type RestTask,
  type RestTaskInput,
  type RestTaskPatch,
  restEventSchema,
} from "./api.js";

// What the console shows, and how it stays current: the board is loaded whole, the feed is
// read from the beginning, and from then on the server's stream says when something changed.
// On every event the lists are loaded again, which is the boring way to be right.

/** How many events the feed keeps on the page. */
const FEED_KEEP = 200;
/** How many pages of the feed are read at the start before the stream takes over. */
const FEED_MAX_PAGES = 20;
/** How long changes that arrive together are gathered before the lists are loaded once. */
const RELOAD_DELAY_MS = 150;

export interface ConsoleActions {
  createTask(input: RestTaskInput): Promise<RestTask>;
  updateTask(id: string, patch: RestTaskPatch): Promise<RestTask>;
  raiseDecision(input: RestDecisionInput): Promise<RestDecision>;
  answerDecision(id: string, input: RestAnswerInput): Promise<RestDecision>;
  signOut(): Promise<void>;
}

export interface ConsoleData {
  /** Who is signed in and what the board is called; `undefined` until the server has answered. */
  readonly me: RestMe | undefined;
  /** What went wrong asking who is signed in, for a person. */
  readonly error: string | undefined;
  /** True once the board has been loaded for the first time. */
  readonly loaded: boolean;
  /** Whether the stream of events is connected. */
  readonly live: boolean;
  readonly tasks: readonly RestTask[];
  readonly decisions: readonly RestDecision[];
  readonly people: readonly RestPerson[];
  /** Oldest first. */
  readonly events: readonly RestEvent[];
  readonly actions: ConsoleActions;
  /** Asks everything again, from who is signed in on. */
  reload(): void;
}

/** The whole feed from the beginning, page by page, bounded. */
async function readFeed(client: ConsoleClient, signal: AbortSignal): Promise<RestEvent[]> {
  const events: RestEvent[] = [];
  let after = 0;
  for (let page = 0; page < FEED_MAX_PAGES; page += 1) {
    const result = await client.events(after, signal);
    events.push(...result.items);
    after = result.items.at(-1)?.id ?? after;
    if (!result.more) {
      break;
    }
  }
  return events.slice(-FEED_KEEP);
}

export function useConsoleData(client: ConsoleClient): ConsoleData {
  const [me, setMe] = useState<RestMe | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const [live, setLive] = useState(false);
  const [tasks, setTasks] = useState<readonly RestTask[]>([]);
  const [decisions, setDecisions] = useState<readonly RestDecision[]>([]);
  const [people, setPeople] = useState<readonly RestPerson[]>([]);
  const [events, setEvents] = useState<readonly RestEvent[]>([]);
  const [generation, setGeneration] = useState(0);
  const lastEvent = useRef(0);

  const reload = useCallback(() => setGeneration((current) => current + 1), []);

  /** Loads the lists again. What fails stays as it was; the next event asks again. */
  const refreshLists = useCallback(
    async (signal?: AbortSignal) => {
      const [nextTasks, nextDecisions, nextPeople] = await Promise.all([
        client.tasks(undefined, signal),
        client.decisions(undefined, signal),
        client.people(signal),
      ]);
      if (signal?.aborted === true) {
        return;
      }
      setTasks(nextTasks.items);
      setDecisions(nextDecisions.items);
      setPeople(nextPeople.items);
    },
    [client],
  );

  // Who is signed in, then the board, then the feed; and the stream from where the feed ends.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `generation` is the trigger
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let source: EventSource | undefined;
    let reloadTimer: ReturnType<typeof setTimeout> | undefined;
    setError(undefined);

    const run = async () => {
      let answer: RestMe;
      try {
        answer = await client.me(signal);
      } catch (failure) {
        if (!signal.aborted) {
          setError(
            failure instanceof ApiError ? failure.message : "The server could not be reached.",
          );
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
        const [, feed] = await Promise.all([refreshLists(signal), readFeed(client, signal)]);
        if (signal.aborted) {
          return;
        }
        setEvents(feed);
        lastEvent.current = feed.at(-1)?.id ?? 0;
        setLoaded(true);
      } catch (failure) {
        if (!signal.aborted) {
          setError(
            failure instanceof ApiError ? failure.message : "The board could not be loaded.",
          );
        }
        return;
      }
      if (typeof EventSource === "undefined") {
        return;
      }
      source = new EventSource(client.eventStreamUrl(lastEvent.current));
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
          refreshLists(signal).catch(() => undefined);
        }, RELOAD_DELAY_MS);
      };
      for (const kind of [
        "person.joined",
        "task.created",
        "task.updated",
        "task.moved",
        "decision.raised",
        "decision.answered",
      ]) {
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
  }, [client, generation, refreshLists]);

  const actions = useMemo<ConsoleActions>(
    () => ({
      async createTask(input) {
        const task = await client.createTask(input);
        await refreshLists();
        return task;
      },
      async updateTask(id, patch) {
        const task = await client.updateTask(id, patch);
        setTasks((current) => current.map((candidate) => (candidate.id === id ? task : candidate)));
        return task;
      },
      async raiseDecision(input) {
        const decision = await client.raiseDecision(input);
        await refreshLists();
        return decision;
      },
      async answerDecision(id, input) {
        const decision = await client.answerDecision(id, input);
        await refreshLists();
        return decision;
      },
      async signOut() {
        await client.signOut();
        setMe((current) => (current === undefined ? undefined : { ...current, person: null }));
        setLoaded(false);
      },
    }),
    [client, refreshLists],
  );

  return { me, error, loaded, live, tasks, decisions, people, events, actions, reload };
}
