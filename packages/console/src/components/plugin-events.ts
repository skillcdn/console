import type { ConsoleClient, PluginClient } from "../client.js";
import type { RestPluginEvent } from "../plugin/rest-schemas.js";

// A plugin's own events (docs/specs/plugins.md, "The bridge"), as the frames of the plugin hear
// them: nothing reaches a frame but through the console's page, so the page asks the console
// for them now and then. One reader serves every frame of a plugin on the page, however many
// widgets and pages of it stand there, so that a front page with four widgets asks for a
// plugin's events once in a while and not four times, and asks nothing while the page is out
// of view.

/** How often a plugin's events are asked for while a frame of it listens and the page is in view. */
export const EVENTS_POLL_MS = 5_000;
/** How many events one ask reads at most; what is past them comes with the next. */
const EVENTS_PAGE = 50;
/** How many events are read to find the newest where the console does not say it (one older than 0.5.0). */
const NEWEST_PAGE = 200;

/** What a reader asks of the page: whether it is out of view, and a word when it comes back. */
export interface PageView {
  readonly hidden: () => boolean;
  readonly onVisible: (listener: () => void) => () => void;
}

/** The document the console's page is: out of view while its tab is in the background. */
const documentView: PageView = {
  hidden: () => typeof document !== "undefined" && document.visibilityState === "hidden",
  onVisible: (listener) => {
    if (typeof document === "undefined") {
      return () => undefined;
    }
    const onChange = () => {
      if (document.visibilityState === "visible") {
        listener();
      }
    };
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  },
};

export type HearPluginEvent = (event: RestPluginEvent) => void;

/**
 * One reader of a plugin's events for the frames of it on the page. While someone listens and
 * the page is in view, it asks the console every `EVENTS_POLL_MS` for what came after the last
 * event it saw, one ask at a time, and tells every listener of each event; a page out of view
 * asks nothing, and asks at once when it comes back. The stream is read from where it stands
 * when the first listener comes: what the plugin emitted before is not replayed, nor what it
 * emitted while nobody listened.
 */
export class PluginEventsReader {
  readonly #client: Pick<PluginClient, "pluginEvents">;
  readonly #view: PageView;
  readonly #listeners = new Set<HearPluginEvent>();
  /** The number of the last event seen; none until the reader has found where the stream stands. */
  #after: number | undefined;
  #asking = false;
  #timer: ReturnType<typeof setInterval> | undefined;
  #stopWatching: (() => void) | undefined;

  constructor(client: Pick<PluginClient, "pluginEvents">, view: PageView = documentView) {
    this.#client = client;
    this.#view = view;
  }

  /** Whether any frame listens. */
  get listening(): boolean {
    return this.#listeners.size > 0;
  }

  /** Hears every event from now on, until what is returned is called. */
  listen(hear: HearPluginEvent): () => void {
    this.#listeners.add(hear);
    if (this.#listeners.size === 1) {
      this.#start();
    }
    return () => {
      this.#listeners.delete(hear);
      if (this.#listeners.size === 0) {
        this.#stop();
      }
    };
  }

  #start(): void {
    this.#after = undefined;
    this.#timer = setInterval(() => void this.#ask(), EVENTS_POLL_MS);
    this.#stopWatching = this.#view.onVisible(() => void this.#ask());
    void this.#ask();
  }

  #stop(): void {
    clearInterval(this.#timer);
    this.#timer = undefined;
    this.#stopWatching?.();
    this.#stopWatching = undefined;
  }

  async #ask(): Promise<void> {
    if (this.#asking || this.#listeners.size === 0 || this.#view.hidden()) {
      return;
    }
    this.#asking = true;
    try {
      const after = this.#after;
      if (after === undefined) {
        this.#after = await this.#newest();
        return;
      }
      const page = await this.#client.pluginEvents({ after, limit: EVENTS_PAGE });
      if (this.#after !== after) {
        // Stopped and started again meanwhile: the stream is read anew from where it stands.
        return;
      }
      for (const event of page.items) {
        this.#after = Math.max(after, event.id);
        for (const hear of this.#listeners) {
          hear(event);
        }
      }
    } catch {
      // Asked again at the next tick.
    } finally {
      this.#asking = false;
    }
  }

  /** Where the stream stands: the number of the newest event, 0 where there is none. */
  async #newest(): Promise<number> {
    const first = await this.#client.pluginEvents({ after: 0, limit: 1 });
    if (first.newest !== undefined) {
      return first.newest;
    }
    // A console older than 0.5.0 says no newest: the first page of the stream is read for it,
    // and past the page the stream is read from the page's last event.
    if (!first.more) {
      return first.items.at(-1)?.id ?? 0;
    }
    const page = await this.#client.pluginEvents({ after: 0, limit: NEWEST_PAGE });
    return page.items.at(-1)?.id ?? 0;
  }
}

const readers = new WeakMap<ConsoleClient, Map<string, PluginEventsReader>>();

/** The one reader of a plugin's events on the pages of a console, made when first asked for. */
export function pluginEventsReaderOf(client: ConsoleClient, key: string): PluginEventsReader {
  let mine = readers.get(client);
  if (mine === undefined) {
    mine = new Map();
    readers.set(client, mine);
  }
  let reader = mine.get(key);
  if (reader === undefined) {
    reader = new PluginEventsReader(client.plugin(key));
    mine.set(key, reader);
  }
  return reader;
}
