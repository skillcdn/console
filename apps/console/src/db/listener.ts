import { Client } from "pg";
import type { Logger } from "../logger.js";
import { EVENTS_CHANNEL } from "./queries/events.js";

// A connection of its own that listens for the nudge every change to the board sends with its
// commit (`recordEvent`), so that a process learns of a change any process made. The pool is not
// used for it: a listening connection is held for the life of the process.

export interface EventListener {
  /** Stops listening. Resolves once the connection is closed. */
  close(): Promise<void>;
}

export interface EventListenerOptions {
  readonly connectionString: string;
  readonly logger: Logger;
  /** Called on every nudge, on no particular tick. It says nothing but that there is something new. */
  readonly onNudge: () => void;
  /** How long to wait before connecting again after the connection is lost, at first. */
  readonly reconnectDelayMs?: number | undefined;
}

const MAX_RECONNECT_DELAY_MS = 30_000;

/**
 * Listens on the events channel and keeps listening: a connection that is lost is made again,
 * with growing waits between attempts. Whatever happened while it was down, a subscriber finds
 * when it asks for what is after its cursor; the nudge only says to ask now.
 */
export function startEventListener(options: EventListenerOptions): EventListener {
  const { connectionString, logger, onNudge } = options;
  const firstDelay = options.reconnectDelayMs ?? 1000;
  let client: Client | undefined;
  let closed = false;
  let delay = firstDelay;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const connect = async (): Promise<void> => {
    if (closed) {
      return;
    }
    const next = new Client({ connectionString, application_name: "console-listener" });
    next.on("notification", () => {
      onNudge();
    });
    const lost = (error?: unknown): void => {
      if (client !== next) {
        return;
      }
      client = undefined;
      if (closed) {
        return;
      }
      logger.warn({ err: error, retryInMs: delay }, "the events listener lost its connection");
      timer = setTimeout(() => void connect(), delay);
      timer.unref();
      delay = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS);
    };
    next.on("error", lost);
    next.on("end", () => lost());
    try {
      await next.connect();
      await next.query(`listen ${EVENTS_CHANNEL}`);
    } catch (error) {
      await next.end().catch(() => {});
      if (!closed) {
        logger.warn({ err: error, retryInMs: delay }, "the events listener could not connect");
        timer = setTimeout(() => void connect(), delay);
        timer.unref();
        delay = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS);
      }
      return;
    }
    client = next;
    delay = firstDelay;
    // Whatever was missed while connecting is found by asking now.
    onNudge();
  };
  void connect();

  return {
    async close() {
      closed = true;
      clearTimeout(timer);
      const current = client;
      client = undefined;
      await current?.end().catch(() => {});
    },
  };
}
