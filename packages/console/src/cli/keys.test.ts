import { describe, expect, it } from "vitest";
import { secretKeys } from "./keys.js";

describe("a secret typed at a hidden prompt", () => {
  it("is what was typed, Backspace taking a character back, up to Enter", () => {
    const keys = secretKeys();
    expect(keys.take("xoxe")).toBe("reading");
    expect(keys.take("-1\u007f2")).toBe("reading");
    expect(keys.take("\r")).toBe("done");
    expect(keys.typed).toBe("xoxe-2");
    // Once done, nothing more is taken.
    expect(keys.take("more\r")).toBe("done");
    expect(keys.typed).toBe("xoxe-2");
  });

  it("takes nothing of what a key that types nothing sends, and a paste between its marks whole", () => {
    const keys = secretKeys();
    // An arrow, Delete, Home in two forms, a function key, a key held with Alt.
    keys.take("ab\u001b[D\u001b[3~c\u001b[H\u001bOH\u001b[15~\u001bx");
    // A paste, as a terminal with bracketed paste on marks it; a chunk may end inside a mark.
    keys.take("d\u001b[20");
    keys.take("0~pasted\u001b[201~e");
    expect(keys.take("\n")).toBe("done");
    expect(keys.typed).toBe("abcdpastede");
  });

  it("is given up with Ctrl-C, and ends with Ctrl-D", () => {
    const given = secretKeys();
    expect(given.take("abc\u0003def")).toBe("interrupted");
    expect(given.typed).toBe("abc");
    const ended = secretKeys();
    expect(ended.take("abc\u0004")).toBe("done");
    expect(ended.typed).toBe("abc");
  });

  it("takes a character back whole, beyond one code unit", () => {
    const keys = secretKeys();
    keys.take("키😀\b");
    expect(keys.take("\r")).toBe("done");
    expect(keys.typed).toBe("키");
  });
});
