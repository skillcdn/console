import { type ConsoleClient, type RestTranscriptEvent, restTranscriptEventSchema } from "./api.js";

// How an agent's page follows one session (ADR-0086): what is there is read page after page,
// and what arrives comes by a stream while the session is open. A browser opens a stream again
// by itself after it was cut, and gives it up for good once it is answered something that is no
// stream, a gateway's error while the console restarts say: the stream is then opened again
// here, from the last event read, so that a conversation a person watches does not stand still
// for good without a word. No React here: the page hands in what it does with what arrives, and
// a test drives it with a stream of its own.

/** How long after a stream closed for good it is opened again, in milliseconds; twice as long each time it fails. */
export const STREAM_RETRY_MS = 3_000;
/** The longest a try waits for the next one. */
export const STREAM_RETRY_MOST_MS = 30_000;
/**
 * How long a stream may be away before the page says so: a browser that lost one opens it again
 * within a few seconds, and a line that came and went that fast would say nothing a person can use.
 */
export const STREAM_GRACE_MS = 5_000;

/**
 * How a session's stream stands: `waiting` while there is none to speak of, before the first one
 * opened and once the session ended; `live` while it is open; `lost` once it has been away for
 * longer than a moment, until it is open again.
 */
export type StreamStanding = "waiting" | "live" | "lost";

/** What of a browser's `EventSource` is used here, so that a test brings its own. */
export interface StreamSource {
  readonly readyState: number;
  onopen: ((event: never) => unknown) | null;
  onerror: ((event: never) => unknown) | null;
  addEventListener(name: string, listener: (message: { readonly data: unknown }) => void): void;
  close(): void;
}

/** `EventSource.CLOSED`: the browser gave the stream up and opens it no more. */
const CLOSED = 2;

export interface FollowSessionOptions {
  readonly client: Pick<ConsoleClient, "transcript" | "transcriptStreamUrl">;
  readonly handle: string;
  /** The session's id. */
  readonly session: string;
  /** The number of the event after which the session is read. */
  readonly after: number;
  /** Whether the session is open, asked once what is there was read: one that is over has no stream. */
  readonly open: () => boolean;
  /** Events not handed over before, in order. */
  readonly onEvents: (events: readonly RestTranscriptEvent[]) => void;
  readonly onStanding: (standing: StreamStanding) => void;
  /** The first read failed: nothing of the session could be read, and nothing more is tried. */
  readonly onProblem: () => void;
  /** The console said the session is over. */
  readonly onEnded: () => void;
  /** What opens a stream: the browser's `EventSource` where left out, and no stream where there is none. */
  readonly EventSource?: (new (url: string) => StreamSource) | undefined;
}

/**
 * Follows a session until the function it answers is called: reads what is there, opens the
 * stream after it, and opens it again from the last event read whenever it closed for good,
 * a few seconds later and further apart while the console does not answer.
 */
export function followSession(options: FollowSessionOptions): () => void {
  const { client, handle, session } = options;
  const controller = new AbortController();
  let stopped = false;
  let last = options.after;
  let source: StreamSource | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let grace: ReturnType<typeof setTimeout> | undefined;
  let wait = STREAM_RETRY_MS;
  /** Whether the session was read once: from then on a read that fails is tried again, and not said as the page's own failure. */
  let read = false;

  const append = (items: readonly RestTranscriptEvent[]): void => {
    const fresh = items.filter((item) => item.n > last);
    if (fresh.length > 0) {
      last = fresh.at(-1)?.n ?? last;
      options.onEvents(fresh);
    }
  };
  const back = (): void => {
    clearTimeout(grace);
    grace = undefined;
    wait = STREAM_RETRY_MS;
    options.onStanding("live");
  };
  /** The stream is away: said once it has been for longer than a moment. */
  const away = (): void => {
    if (grace === undefined) {
      grace = setTimeout(() => {
        grace = undefined;
        if (!stopped) {
          options.onStanding("lost");
        }
      }, STREAM_GRACE_MS);
    }
  };
  const again = (): void => {
    if (stopped || retry !== undefined) {
      return;
    }
    away();
    retry = setTimeout(() => {
      retry = undefined;
      void run();
    }, wait);
    wait = Math.min(wait * 2, STREAM_RETRY_MOST_MS);
  };
  const run = async (): Promise<void> => {
    try {
      // Page after page until what is there now is read.
      for (;;) {
        const page = await client.transcript(
          handle,
          session,
          { after: last, limit: 500 },
          controller.signal,
        );
        if (stopped) {
          return;
        }
        append(page.items);
        if (!page.more) {
          break;
        }
      }
    } catch {
      if (stopped) {
        return;
      }
      if (read) {
        again();
      } else {
        options.onProblem();
      }
      return;
    }
    read = true;
    const Source =
      options.EventSource ??
      (typeof EventSource === "undefined"
        ? undefined
        : (EventSource as unknown as new (
            url: string,
          ) => StreamSource));
    if (!options.open() || Source === undefined) {
      return;
    }
    const stream = new Source(client.transcriptStreamUrl(handle, session, last));
    source = stream;
    stream.onopen = () => back();
    stream.onerror = () => {
      if (stopped || source !== stream) {
        return;
      }
      if (stream.readyState === CLOSED) {
        // The browser opens it no more: it is opened again here, after what was missed is read.
        stream.close();
        source = undefined;
        again();
      } else {
        away();
      }
    };
    stream.addEventListener("event", (message) => {
      try {
        const parsed = restTranscriptEventSchema.safeParse(JSON.parse(String(message.data)));
        if (parsed.success) {
          append([parsed.data]);
        }
      } catch {
        // What does not read as an event is left out.
      }
    });
    // The console says so once, when the session is over: nothing more arrives, and nothing is opened again.
    stream.addEventListener("end", () => {
      stream.close();
      if (source === stream) {
        source = undefined;
      }
      clearTimeout(grace);
      grace = undefined;
      options.onStanding("waiting");
      options.onEnded();
    });
  };
  run().catch(() => undefined);
  return () => {
    stopped = true;
    controller.abort();
    clearTimeout(retry);
    clearTimeout(grace);
    source?.close();
    source = undefined;
  };
}
