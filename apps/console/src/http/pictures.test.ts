import { describe, expect, it } from "vitest";
import type { PictureFetch, PictureRequest, PictureSource } from "../ports/picture-source.js";
import { PictureCache } from "./pictures.js";

// The pictures kept in memory, with the source and the clock answered from here.

const bytesOf = (text: string) => new TextEncoder().encode(text);
const picture = (text: string, etag?: string): PictureFetch => ({
  kind: "picture",
  bytes: bytesOf(text),
  contentType: "image/png",
  etag,
  lastModified: undefined,
});

function harness(options: { maxBytes?: number; maxEntryBytes?: number } = {}) {
  let now = 1_000_000;
  const asked: PictureRequest[] = [];
  let answers: ((request: PictureRequest) => PictureFetch | Promise<PictureFetch>)[] = [];
  const source: PictureSource = {
    async fetch(request) {
      asked.push(request);
      const next = answers.shift();
      if (next === undefined) {
        throw new Error("nothing was queued to answer");
      }
      return next(request);
    },
  };
  const cache = new PictureCache({
    source,
    clock: { now: () => new Date(now) },
    maxBytes: options.maxBytes ?? 100,
    maxEntryBytes: options.maxEntryBytes ?? 50,
    freshMs: 1000,
    staleMs: 5000,
    refusedMs: 300,
  });
  return {
    cache,
    asked,
    answer: (...next: typeof answers) => {
      answers = [...answers, ...next];
    },
    pass: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

describe("the pictures kept", () => {
  it("fetches a picture once for everyone who looks while it is fresh, then asks the origin again with what it said", async () => {
    const h = harness();
    h.answer(() => picture("one", '"v1"'));
    const [first, second] = await Promise.all([
      h.cache.get("https://img.example/x.png"),
      h.cache.get("https://img.example/x.png"),
    ]);
    expect(first.kind).toBe("picture");
    expect(second).toBe(first);
    expect(h.asked).toHaveLength(1);
    h.pass(999);
    expect(await h.cache.get("https://img.example/x.png")).toEqual(first);
    expect(h.asked).toHaveLength(1);
    // Stale: asked again with the validator, and kept when unchanged.
    h.pass(2);
    h.answer(() => ({ kind: "unchanged" }));
    const kept = await h.cache.get("https://img.example/x.png");
    expect(kept.kind === "picture" && new TextDecoder().decode(kept.picture.bytes)).toBe("one");
    expect(h.asked[1]).toEqual({
      url: "https://img.example/x.png",
      etag: '"v1"',
      lastModified: undefined,
    });
    // Replaced when the origin has a new one.
    h.pass(1001);
    h.answer(() => picture("two", '"v2"'));
    const replaced = await h.cache.get("https://img.example/x.png");
    expect(replaced.kind === "picture" && new TextDecoder().decode(replaced.picture.bytes)).toBe(
      "two",
    );
    expect(h.cache.bytes).toBe(3);
  });

  it("keeps serving a picture while the origin is away, and keeps a refusal a short while", async () => {
    const h = harness();
    h.answer(() => picture("one"));
    await h.cache.get("https://img.example/x.png");
    h.pass(1001);
    h.answer(() => ({ kind: "refused", reason: "unreachable" }));
    expect((await h.cache.get("https://img.example/x.png")).kind).toBe("picture");
    // Not asked again until the picture is stale again.
    expect((await h.cache.get("https://img.example/x.png")).kind).toBe("picture");
    expect(h.asked).toHaveLength(2);
    // Gone for good once the stale time is over.
    h.pass(5001);
    h.answer(() => ({ kind: "refused", reason: "unreachable" }));
    expect(await h.cache.get("https://img.example/x.png")).toEqual({
      kind: "refused",
      reason: "unreachable",
    });
    expect(await h.cache.get("https://img.example/x.png")).toEqual({
      kind: "refused",
      reason: "unreachable",
    });
    expect(h.asked).toHaveLength(3);
    h.pass(301);
    h.answer(() => picture("back"));
    expect((await h.cache.get("https://img.example/x.png")).kind).toBe("picture");
    // A refusal that is not the origin's absence replaces the picture at once.
    h.pass(1001);
    h.answer(() => ({ kind: "refused", reason: "not_a_picture" }));
    expect(await h.cache.get("https://img.example/x.png")).toEqual({
      kind: "refused",
      reason: "not_a_picture",
    });
    expect(h.cache.bytes).toBe(0);
  });

  it("lets the oldest go when the room is full, and takes no picture over the bound", async () => {
    const h = harness({ maxBytes: 10, maxEntryBytes: 6 });
    h.answer(
      () => picture("aaaa"),
      () => picture("bbbb"),
      () => picture("cccc"),
    );
    await h.cache.get("https://img.example/a");
    await h.cache.get("https://img.example/b");
    // Used again, a is the newest; c then pushes b out.
    await h.cache.get("https://img.example/a");
    await h.cache.get("https://img.example/c");
    expect(h.cache.bytes).toBe(8);
    expect(h.cache.size).toBe(2);
    h.answer(() => picture("bbbb"));
    await h.cache.get("https://img.example/b");
    expect(h.asked.map((request) => request.url)).toEqual([
      "https://img.example/a",
      "https://img.example/b",
      "https://img.example/c",
      "https://img.example/b",
    ]);
    h.answer(() => picture("too large"));
    expect(await h.cache.get("https://img.example/huge")).toEqual({
      kind: "refused",
      reason: "too_large",
    });
  });
});
