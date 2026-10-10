import { describe, expect, it } from "vitest";
import { CONNECT_CODE_ALPHABET, isConnectCode, normalizeConnectCode } from "./connect.js";

describe("a connect code", () => {
  it("is eight characters from an alphabet without look-alikes, in two groups", () => {
    expect(CONNECT_CODE_ALPHABET).not.toMatch(/[01IO]/);
    expect(CONNECT_CODE_ALPHABET).toHaveLength(32);
    expect(isConnectCode("ABCD-EFGH")).toBe(true);
    expect(isConnectCode("abcd-efgh")).toBe(false);
    expect(isConnectCode("ABCDEFGH")).toBe(false);
    expect(isConnectCode("ABCD-EFG1")).toBe(false);
    expect(isConnectCode("ABCD-EFGH-")).toBe(false);
  });

  it("is read as a person types it: any case, with or without the hyphen, spaces around", () => {
    expect(normalizeConnectCode(" abcd efgh ")).toBe("ABCD-EFGH");
    expect(normalizeConnectCode("abcdefgh")).toBe("ABCD-EFGH");
    expect(normalizeConnectCode("ABCD-EFGH")).toBe("ABCD-EFGH");
    expect(normalizeConnectCode("ABCD-EFG")).toBeUndefined();
    expect(normalizeConnectCode("ABCD-EFG0")).toBeUndefined();
    expect(normalizeConnectCode("ABCD-EFGHJ")).toBeUndefined();
    expect(normalizeConnectCode("")).toBeUndefined();
    // What a copy may carry along is dropped; what is not a code stays none.
    expect(normalizeConnectCode(`ABCD${String.fromCodePoint(0x200b)}-EFGH`)).toBe("ABCD-EFGH");
    expect(normalizeConnectCode("<script>")).toBeUndefined();
  });
});
