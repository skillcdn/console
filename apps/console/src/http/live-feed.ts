import type { Database } from "../db/client.js";
import { type EventRecord, type EventScope, listEventsAfter } from "../db/queries/events.js";

// The feed as it happens: every subscriber holds a cursor, the number of the last event it was
// sent, and is woken to ask for what is after it whenever any process changes the board
// (`recordEvent`'s nudge, delivered through the listener), on a timer in case a nudge was
// missed, and for a heartbeat that keeps the connection known to be alive.

export type FeedMessage =
  | { readonly kind: "events"; readonly items: readonly EventRecord[] }
  | { readonly kind: "heartbeat" };

export interface LiveFeedOptions {
  readonly database: Database;
  /** How many events one wake-up sends at most before the next; the rest follow at once. */
  readonly pageLimit: number;
  /** How long a subscriber waits in silence before a heartbeat. */
  readonly heartbeatMs: number;
  /** How long a subscriber goes without asking, nudge or no nudge. */
  readonly pollMs: number;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** One subscriber: a cursor, the scope of the feed it reads, whose stream it is, and the way to wake it. */
export class Subscription implements AsyncIterable<FeedMessage> {
  #cursor: number;
  #wake: (() => void) | undefined;
  #pending = false;
  #ended = false;
  readonly #scope: EventScope;
  readonly #options: LiveFeedOptions;
  readonly #onEnd: () => void;
  readonly #owner: string | undefined;

  constructor(
    after: number,
    scope: EventScope,
    options: LiveFeedOptions,
    onEnd: () => void,
    owner?: string,
  ) {
    this.#cursor = after;
    this.#scope = scope;
    this.#options = options;
    this.#onEnd = onEnd;
    this.#owner = owner;
  }

  /** The number of the last event sent. */
  get cursor(): number {
    return this.#cursor;
  }

  /** The person whose stream this is, for one a person opened; nothing for the console's own waiting. */
  get owner(): string | undefined {
    return this.#owner;
  }

  /** Asks the subscriber to look again. A wake-up that arrives while it looks is not lost. */
  wake(): void {
    this.#pending = true;
    this.#wake?.();
  }

  /** Ends the subscription: the iterator finishes after what it is doing. */
  end(): void {
    if (!this.#ended) {
      this.#ended = true;
      this.#onEnd();
      this.#wake?.();
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<FeedMessage, void, undefined> {
    const { database, pageLimit, heartbeatMs, pollMs } = this.#options;
    let lastAsked = Date.now();
    let lastSent = Date.now();
    this.#pending = true;
    try {
      while (!this.#ended) {
        if (this.#pending) {
          this.#pending = false;
          lastAsked = Date.now();
          let more = true;
          while (more && !this.#ended) {
            const page = await listEventsAfter(database, this.#scope, this.#cursor, pageLimit);
            more = page.more;
            if (page.items.length > 0) {
              this.#cursor = page.items[page.items.length - 1]?.id ?? this.#cursor;
              lastSent = Date.now();
              yield { kind: "events", items: page.items };
            }
          }
          continue;
        }
        const now = Date.now();
        const untilPoll = Math.max(0, lastAsked + pollMs - now);
        const untilHeartbeat = Math.max(0, lastSent + heartbeatMs - now);
        const waited = await this.#waitFor(Math.min(untilPoll, untilHeartbeat));
        if (this.#ended) {
          break;
        }
        if (waited === "timeout") {
          if (Date.now() >= lastAsked + pollMs) {
            this.#pending = true;
          } else {
            lastSent = Date.now();
            yield { kind: "heartbeat" };
          }
        }
      }
    } finally {
      this.end();
    }
  }

  /** Resolves on a wake-up, or after `milliseconds` of none. */
  #waitFor(milliseconds: number): Promise<"woken" | "timeout"> {
    if (this.#pending || this.#ended) {
      return Promise.resolve("woken");
    }
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      this.#wake = () => {
        clearTimeout(timer);
        this.#wake = undefined;
        resolve("woken");
      };
      timer = setTimeout(() => {
        this.#wake = undefined;
        resolve("timeout");
      }, milliseconds);
    });
  }
}

/**
 * The subscribers of this process. `nudge` wakes them all; `close` ends them all, which is how
 * shutdown lets the listener go: a stream that never ends would hold the server open.
 */
export class LiveFeed {
  readonly #options: LiveFeedOptions;
  readonly #subscriptions = new Set<Subscription>();
  /** How many streams each person holds, for the bound on them; a person with none is not here. */
  readonly #streams = new Map<string, number>();
  #closed = false;

  constructor(options: LiveFeedOptions) {
    this.#options = options;
  }

  get size(): number {
    return this.#subscriptions.size;
  }

  /** How many streams people hold in this process: the subscriptions with an owner. */
  get streams(): number {
    let total = 0;
    for (const held of this.#streams.values()) {
      total += held;
    }
    return total;
  }

  /** How many streams one person holds in this process. */
  streamsOf(owner: string): number {
    return this.#streams.get(owner) ?? 0;
  }

  nudge(): void {
    for (const subscription of this.#subscriptions) {
      subscription.wake();
    }
  }

  /**
   * A subscription to one scope of the feed from event number `after` on, counted as a stream
   * of `owner` when a person opened it; ended at once when the feed is closed.
   */
  subscribe(after: number, scope: EventScope, owner?: string): Subscription {
    const subscription = new Subscription(
      after,
      scope,
      this.#options,
      () => {
        if (this.#subscriptions.delete(subscription) && owner !== undefined) {
          const held = (this.#streams.get(owner) ?? 1) - 1;
          if (held > 0) {
            this.#streams.set(owner, held);
          } else {
            this.#streams.delete(owner);
          }
        }
      },
      owner,
    );
    if (this.#closed) {
      subscription.end();
    } else {
      this.#subscriptions.add(subscription);
      if (owner !== undefined) {
        this.#streams.set(owner, (this.#streams.get(owner) ?? 0) + 1);
      }
    }
    return subscription;
  }

  /** Ends every subscription and refuses new ones. */
  close(): void {
    this.#closed = true;
    for (const subscription of [...this.#subscriptions]) {
      subscription.end();
    }
  }

  /** For tests: a moment of no subscriber busy, so that a close can be waited for. */
  async idle(): Promise<void> {
    while (this.#subscriptions.size > 0) {
      await sleep(10);
    }
  }
}
