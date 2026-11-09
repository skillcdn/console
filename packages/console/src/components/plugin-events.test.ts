import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RestPluginEvent, RestPluginEvents } from "../plugin/rest-schemas.js";
import { EVENTS_POLL_MS, type PageView, PluginEventsReader } from "./plugin-events.js";

const eventOf = (id: number): RestPluginEvent => ({
  id,
  kind: "ping",
  data: { id },
  at: "2026-11-09T00:00:00.000Z",
});

/** A console whose stream is `events`, answering as the route does and counting the asks. */
function consoleWith(events: RestPluginEvent[], options: { readonly newest?: boolean } = {}) {
  const asks: { after: number; limit: number }[] = [];
  let answer: (() => void) | undefined;
  const client = {
    pluginEvents: async (page: { after: number; limit: number }): Promise<RestPluginEvents> => {
      asks.push(page);
      await new Promise<void>((resolve) => {
        if (answer === undefined) {
          resolve();
        } else {
          const held = answer;
          answer = () => {
            held();
            resolve();
          };
        }
      });
      const after = events.filter((event) => event.id > page.after);
      return {
        items: after.slice(0, page.limit),
        more: after.length > page.limit,
        ...(options.newest === false ? {} : { newest: events.at(-1)?.id ?? 0 }),
      };
    },
  };
  return {
    client,
    asks,
    events,
    /** Holds every answer until `release` is called. */
    hold: () => {
      answer = () => undefined;
    },
    release: () => {
      const held = answer;
      answer = undefined;
      held?.();
    },
  };
}

/** A page that is shown or hidden as the test says. */
function pageView(hiddenAtFirst = false) {
  let hidden = hiddenAtFirst;
  const listeners = new Set<() => void>();
  const view: PageView = {
    hidden: () => hidden,
    onVisible: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    view,
    listeners,
    hide: () => {
      hidden = true;
    },
    show: () => {
      hidden = false;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

describe("the reader of a plugin's events", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks once for every frame of the plugin, and tells each of them", async () => {
    const { client, asks, events } = consoleWith([eventOf(1), eventOf(2)]);
    const reader = new PluginEventsReader(client, pageView().view);
    const heardA: number[] = [];
    const heardB: number[] = [];
    reader.listen((event) => heardA.push(event.id));
    reader.listen((event) => heardB.push(event.id));
    await vi.advanceTimersByTimeAsync(0);
    // Where the stream stands, asked once: what came before is not replayed.
    expect(asks).toEqual([{ after: 0, limit: 1 }]);
    expect(heardA).toEqual([]);
    events.push(eventOf(3), eventOf(4));
    await vi.advanceTimersByTimeAsync(EVENTS_POLL_MS);
    expect(asks).toEqual([
      { after: 0, limit: 1 },
      { after: 2, limit: 50 },
    ]);
    expect(heardA).toEqual([3, 4]);
    expect(heardB).toEqual([3, 4]);
    await vi.advanceTimersByTimeAsync(EVENTS_POLL_MS);
    expect(asks.at(-1)).toEqual({ after: 4, limit: 50 });
    expect(heardA).toEqual([3, 4]);
  });

  it("asks nothing while the page is out of view, and at once when it comes back", async () => {
    const { client, asks, events } = consoleWith([eventOf(1)]);
    const page = pageView(true);
    const reader = new PluginEventsReader(client, page.view);
    const heard: number[] = [];
    reader.listen((event) => heard.push(event.id));
    await vi.advanceTimersByTimeAsync(EVENTS_POLL_MS * 3);
    expect(asks).toEqual([]);
    page.show();
    await vi.advanceTimersByTimeAsync(0);
    expect(asks).toEqual([{ after: 0, limit: 1 }]);
    events.push(eventOf(2));
    page.hide();
    await vi.advanceTimersByTimeAsync(EVENTS_POLL_MS * 3);
    expect(asks).toHaveLength(1);
    page.show();
    await vi.advanceTimersByTimeAsync(0);
    expect(asks).toHaveLength(2);
    expect(heard).toEqual([2]);
  });

  it("stops asking when the last frame leaves, and reads anew from where the stream stands when one comes", async () => {
    const { client, asks, events } = consoleWith([]);
    const page = pageView();
    const reader = new PluginEventsReader(client, page.view);
    const heard: number[] = [];
    const stop = reader.listen((event) => heard.push(event.id));
    await vi.advanceTimersByTimeAsync(0);
    expect(asks).toHaveLength(1);
    expect(reader.listening).toBe(true);
    stop();
    expect(reader.listening).toBe(false);
    expect(page.listeners.size).toBe(0);
    events.push(eventOf(1));
    await vi.advanceTimersByTimeAsync(EVENTS_POLL_MS * 3);
    expect(asks).toHaveLength(1);
    reader.listen((event) => heard.push(event.id));
    await vi.advanceTimersByTimeAsync(0);
    // What was emitted while nobody listened is not replayed.
    expect(asks.at(-1)).toEqual({ after: 0, limit: 1 });
    events.push(eventOf(2));
    await vi.advanceTimersByTimeAsync(EVENTS_POLL_MS);
    expect(asks.at(-1)).toEqual({ after: 1, limit: 50 });
    expect(heard).toEqual([2]);
  });

  it("finds where the stream stands on a console that does not say it", async () => {
    const { client, asks, events } = consoleWith([eventOf(1), eventOf(2), eventOf(3)], {
      newest: false,
    });
    const reader = new PluginEventsReader(client, pageView().view);
    const heard: number[] = [];
    reader.listen((event) => heard.push(event.id));
    await vi.advanceTimersByTimeAsync(0);
    expect(asks).toEqual([
      { after: 0, limit: 1 },
      { after: 0, limit: 200 },
    ]);
    events.push(eventOf(4));
    await vi.advanceTimersByTimeAsync(EVENTS_POLL_MS);
    expect(asks.at(-1)).toEqual({ after: 3, limit: 50 });
    expect(heard).toEqual([4]);
    // An empty stream is one ask: nothing stands.
    const empty = consoleWith([], { newest: false });
    new PluginEventsReader(empty.client, pageView().view).listen(() => undefined);
    await vi.advanceTimersByTimeAsync(EVENTS_POLL_MS);
    expect(empty.asks).toEqual([
      { after: 0, limit: 1 },
      { after: 0, limit: 50 },
    ]);
  });

  it("asks once at a time, however long an answer takes", async () => {
    const held = consoleWith([eventOf(1)]);
    const reader = new PluginEventsReader(held.client, pageView().view);
    reader.listen(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(held.asks).toHaveLength(1);
    held.hold();
    await vi.advanceTimersByTimeAsync(EVENTS_POLL_MS * 3);
    // The one ask waits; no tick starts another beside it.
    expect(held.asks).toHaveLength(2);
    held.release();
    await vi.advanceTimersByTimeAsync(EVENTS_POLL_MS);
    expect(held.asks).toHaveLength(3);
  });
});
