import { describe, expect, it } from "vitest";
import { type ChainedEvent, chainNext, chainStart, eventDigest } from "./transcript-chain.js";

// The chain a session's events are held by (ADR-0090): what is hashed, said once.

const EVENT: ChainedEvent = {
  sessionId: "01a1c000-0000-7000-8000-000000000001",
  n: 3,
  kind: "tool_result",
  at: new Date("2026-11-10T09:00:00.123Z"),
  text: "README.md\nwork",
  textSha256: null,
  textSize: null,
  data: { id: "call-1", error: false },
  files: [
    {
      id: "01a1c000-0000-7000-8000-000000000002",
      name: "tool-1-1.png",
      size: 9,
      contentType: "image/png",
      sha256: "a".repeat(64),
    },
  ],
};

describe("a session's chain", () => {
  it("takes a digest of everything an event holds, and of nothing else", () => {
    const digest = eventDigest(EVENT);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(eventDigest({ ...EVENT })).toBe(digest);
    // The order its facts were written in is nobody's to depend on.
    expect(eventDigest({ ...EVENT, data: { error: false, id: "call-1" } })).toBe(digest);
    // Anything it holds, changed, is another digest: its place, its kind, its time, its text,
    // a fact, a picture, and what is kept apart of a long text.
    const changed: ChainedEvent[] = [
      { ...EVENT, sessionId: "01a1c000-0000-7000-8000-000000000009" },
      { ...EVENT, n: 4 },
      { ...EVENT, kind: "tool_call" },
      { ...EVENT, at: new Date("2026-11-10T09:00:00.124Z") },
      { ...EVENT, text: "README.md\nwork " },
      { ...EVENT, textSha256: "b".repeat(64), textSize: 90_000 },
      { ...EVENT, data: { id: "call-1", error: true } },
      { ...EVENT, data: { id: "call-1" } },
      { ...EVENT, files: [] },
      { ...EVENT, files: [{ ...EVENT.files[0], sha256: "c".repeat(64) }] as ChainedEvent["files"] },
    ];
    const digests = new Set(changed.map(eventDigest));
    expect(digests.size).toBe(changed.length);
    expect(digests.has(digest)).toBe(false);
  });

  it("begins at the session itself and folds a digest at a time, in order", () => {
    const start = chainStart(EVENT.sessionId);
    expect(start).toMatch(/^[0-9a-f]{64}$/);
    expect(chainStart("01a1c000-0000-7000-8000-000000000009")).not.toBe(start);
    const first = eventDigest({ ...EVENT, n: 1 });
    const second = eventDigest({ ...EVENT, n: 2 });
    const head = chainNext(chainNext(start, first), second);
    expect(head).toMatch(/^[0-9a-f]{64}$/);
    // The other way round, one left out, or one twice, is another head.
    expect(chainNext(chainNext(start, second), first)).not.toBe(head);
    expect(chainNext(start, second)).not.toBe(head);
    expect(chainNext(head, second)).not.toBe(head);
  });

  it("stays what it is from one release to the next", () => {
    // What was kept by one version is checked by the next: a change of these is a new form.
    const start = chainStart(EVENT.sessionId);
    const digest = eventDigest(EVENT);
    expect(start).toBe("5a947121ae26ced8bc6ef2354d0e45800c104a613c53a148def77a5e83203bf7");
    expect(digest).toBe("347f733e925779e6196b029fc488f69caa4d1a1c4f9ad6c1173c187a258ff827");
    expect(chainNext(start, digest)).toBe(
      "a093ed4e4fadc771e11b79e6bf7f47102c639902c68f0ddba7846d3f11d39a80",
    );
  });
});
