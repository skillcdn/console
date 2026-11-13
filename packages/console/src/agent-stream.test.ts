import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  followSession,
  STREAM_GRACE_MS,
  STREAM_RETRY_MS,
  type StreamStanding,
} from "./agent-stream.js";
import type { RestTranscriptEvent } from "./api.js";

const SESSION = "0199c4d8-0000-7000-8000-0000000000a1";

const event = (n: number, text = `event ${n}`): RestTranscriptEvent => ({
  n,
  at: `2026-11-14T03:00:${String(n % 60).padStart(2, "0")}.000Z`,
  kind: "assistant",
  text,
  whole: null,
  data: {},
  files: [],
  sealed: null,
});

/** A stream as a browser has one, driven by the test: opened, sent an event, failed, closed for good. */
class FakeSource {
  static made: FakeSource[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  readonly listeners = new Map<string, (message: { data: unknown }) => void>();
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    FakeSource.made.push(this);
  }
  addEventListener(name: string, listener: (message: { data: unknown }) => void): void {
    this.listeners.set(name, listener);
  }
  close(): void {
    this.closed = true;
    this.readyState = 2;
  }
  opens(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  /** The browser lost the stream and is opening it again by itself. */
  drops(): void {
    this.readyState = 0;
    this.onerror?.();
  }
  /** The browser gave the stream up: an answer that is no stream, a 502 while the console restarts. */
  givesUp(): void {
    this.readyState = 2;
    this.onerror?.();
  }
  sends(name: string, data: unknown): void {
    this.listeners.get(name)?.({ data: JSON.stringify(data) });
  }
}

interface Page {
  readonly items: RestTranscriptEvent[];
  readonly more: boolean;
}

function setup(pages: (after: number) => Page | Promise<Page>, open = true) {
  const asked: number[] = [];
  const events: RestTranscriptEvent[] = [];
  const standings: StreamStanding[] = [];
  let problems = 0;
  let ended = 0;
  const stop = followSession({
    client: {
      transcript: async (_handle, _session, query) => {
        asked.push(query?.after ?? 0);
        return pages(query?.after ?? 0);
      },
      transcriptStreamUrl: (handle, session, after) =>
        `/stream/${handle}/${session}?after=${after}`,
    },
    handle: "mira",
    session: SESSION,
    after: 0,
    open: () => open,
    onEvents: (fresh) => events.push(...fresh),
    onStanding: (standing) => standings.push(standing),
    onProblem: () => {
      problems += 1;
    },
    onEnded: () => {
      ended += 1;
    },
    EventSource: FakeSource,
  });
  return {
    stop,
    asked,
    events,
    standings,
    problems: () => problems,
    ended: () => ended,
  };
}

/** Lets what was awaited settle: the reads here answer at once. */
const settle = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
};

describe("followSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSource.made = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads what is there page after page, then follows the stream from the last event read", async () => {
    const followed = setup((after) =>
      after === 0
        ? { items: [event(1), event(2)], more: true }
        : { items: [event(3)], more: false },
    );
    await settle();
    expect(followed.asked).toEqual([0, 2]);
    expect(followed.events.map((one) => one.n)).toEqual([1, 2, 3]);
    expect(FakeSource.made).toHaveLength(1);
    expect(FakeSource.made[0]?.url).toBe(`/stream/mira/${SESSION}?after=3`);
    FakeSource.made[0]?.opens();
    expect(followed.standings.at(-1)).toBe("live");
    // What the stream says twice, as it does when the browser opens it again, is shown once.
    FakeSource.made[0]?.sends("event", event(3));
    FakeSource.made[0]?.sends("event", event(4));
    FakeSource.made[0]?.sends("event", { not: "an event" });
    expect(followed.events.map((one) => one.n)).toEqual([1, 2, 3, 4]);
    followed.stop();
    expect(FakeSource.made[0]?.closed).toBe(true);
  });

  it("opens a stream that closed for good again, from the last event read, and says so meanwhile", async () => {
    let restarted = false;
    const followed = setup((after) =>
      !restarted
        ? { items: [event(1)], more: false }
        : { items: [event(2), event(3)].filter((one) => one.n > after), more: false },
    );
    await settle();
    const first = FakeSource.made[0];
    first?.opens();
    // The console restarts: the browser is answered something that is no stream, and gives up.
    restarted = true;
    first?.givesUp();
    expect(first?.closed).toBe(true);
    expect(FakeSource.made).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(STREAM_RETRY_MS);
    // What was missed is read first, and the stream is opened after it.
    expect(followed.asked).toEqual([0, 1]);
    expect(followed.events.map((one) => one.n)).toEqual([1, 2, 3]);
    expect(FakeSource.made).toHaveLength(2);
    expect(FakeSource.made[1]?.url).toBe(`/stream/mira/${SESSION}?after=3`);
    await vi.advanceTimersByTimeAsync(STREAM_GRACE_MS);
    expect(followed.standings.at(-1)).toBe("lost");
    FakeSource.made[1]?.opens();
    expect(followed.standings.at(-1)).toBe("live");
    expect(followed.problems()).toBe(0);
    followed.stop();
  });

  it("goes on trying, further apart, while the console does not answer", async () => {
    let down = false;
    const followed = setup(() => {
      if (down) {
        throw new Error("no answer");
      }
      return { items: [event(1)], more: false };
    });
    await settle();
    FakeSource.made[0]?.opens();
    down = true;
    FakeSource.made[0]?.givesUp();
    await vi.advanceTimersByTimeAsync(STREAM_RETRY_MS);
    expect(followed.asked).toHaveLength(2);
    expect(FakeSource.made).toHaveLength(1);
    // The next try waits twice as long.
    await vi.advanceTimersByTimeAsync(STREAM_RETRY_MS);
    expect(followed.asked).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(STREAM_RETRY_MS);
    expect(followed.asked).toHaveLength(3);
    expect(followed.standings.at(-1)).toBe("lost");
    // Nothing of this is the page's first read failing: the conversation read so far stays.
    expect(followed.problems()).toBe(0);
    down = false;
    await vi.advanceTimersByTimeAsync(4 * STREAM_RETRY_MS);
    expect(FakeSource.made).toHaveLength(2);
    followed.stop();
  });

  it("says nothing of a stream the browser opened again by itself within a moment", async () => {
    const followed = setup(() => ({ items: [event(1)], more: false }));
    await settle();
    const stream = FakeSource.made[0];
    stream?.opens();
    stream?.drops();
    await vi.advanceTimersByTimeAsync(STREAM_GRACE_MS - 1);
    stream?.opens();
    await vi.advanceTimersByTimeAsync(STREAM_GRACE_MS);
    expect(followed.standings).not.toContain("lost");
    expect(FakeSource.made).toHaveLength(1);
    // One that stays away longer is said to be lost, and is still the browser's to open again.
    stream?.drops();
    await vi.advanceTimersByTimeAsync(STREAM_GRACE_MS);
    expect(followed.standings.at(-1)).toBe("lost");
    expect(FakeSource.made).toHaveLength(1);
    followed.stop();
  });

  it("says a first read that failed, and tries nothing more", async () => {
    const followed = setup(() => {
      throw new Error("no answer");
    });
    await settle();
    expect(followed.problems()).toBe(1);
    await vi.advanceTimersByTimeAsync(10 * STREAM_RETRY_MS);
    expect(followed.asked).toHaveLength(1);
    expect(FakeSource.made).toHaveLength(0);
    followed.stop();
  });

  it("ends with the session, and opens nothing again", async () => {
    const followed = setup(() => ({ items: [event(1)], more: false }));
    await settle();
    const stream = FakeSource.made[0];
    stream?.opens();
    stream?.sends("end", { whatever: "the session" });
    expect(stream?.closed).toBe(true);
    expect(followed.ended()).toBe(1);
    expect(followed.standings.at(-1)).toBe("waiting");
    await vi.advanceTimersByTimeAsync(10 * STREAM_RETRY_MS);
    expect(FakeSource.made).toHaveLength(1);
    followed.stop();
  });

  it("follows no stream of a session that is over, and none once it was stopped", async () => {
    const over = setup(() => ({ items: [event(1)], more: false }), false);
    await settle();
    expect(over.events).toHaveLength(1);
    expect(FakeSource.made).toHaveLength(0);
    over.stop();

    const followed = setup(() => ({ items: [event(1)], more: false }));
    await settle();
    FakeSource.made[0]?.opens();
    FakeSource.made[0]?.givesUp();
    followed.stop();
    await vi.advanceTimersByTimeAsync(10 * STREAM_RETRY_MS);
    expect(FakeSource.made).toHaveLength(1);
    expect(followed.asked).toHaveLength(1);
  });
});
