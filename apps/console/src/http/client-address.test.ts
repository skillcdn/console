import { describe, expect, it } from "vitest";
import {
  acceptRequestId,
  createClientAddressResolver,
  normalizeAddress,
  parseCidr,
} from "./client-address.js";

describe("parseCidr", () => {
  it("takes networks and bare addresses of both families", () => {
    expect(parseCidr("10.0.0.0/8")).toEqual({ address: "10.0.0.0", prefix: 8, family: "ipv4" });
    expect(parseCidr(" 127.0.0.1 ")).toEqual({
      address: "127.0.0.1",
      prefix: 32,
      family: "ipv4",
    });
    expect(parseCidr("::1")).toEqual({ address: "::1", prefix: 128, family: "ipv6" });
    expect(parseCidr("fd00::/8")).toEqual({ address: "fd00::", prefix: 8, family: "ipv6" });
  });

  it("refuses what is not one", () => {
    for (const text of ["proxy.internal", "10.0.0.0/33", "10.0.0.0/8/1", "10.0.0.0/x", ""]) {
      expect(parseCidr(text), text).toBeUndefined();
    }
  });
});

describe("the client address", () => {
  const headers = (entries: Record<string, string>) => new Headers(entries);
  const resolver = createClientAddressResolver({
    trustedProxies: [parseCidr("10.0.0.0/8") ?? { address: "", prefix: 0, family: "ipv4" }],
    header: "x-forwarded-for",
  });

  it("is the peer, unless the peer is a trusted proxy that names someone else", () => {
    expect(resolver.resolve("203.0.113.5", headers({ "x-forwarded-for": "1.2.3.4" }))).toBe(
      "203.0.113.5",
    );
    expect(resolver.resolve("10.1.1.1", headers({ "x-forwarded-for": "203.0.113.5" }))).toBe(
      "203.0.113.5",
    );
    expect(resolver.resolve("10.1.1.1", headers({}))).toBe("10.1.1.1");
    expect(resolver.resolve(undefined, headers({ "x-forwarded-for": "1.2.3.4" }))).toBeUndefined();
  });

  it("walks the chain from the nearest proxy and stops at the first stranger", () => {
    expect(
      resolver.resolve(
        "10.1.1.1",
        headers({ "x-forwarded-for": "9.9.9.9, 203.0.113.5, 10.2.2.2, 10.3.3.3" }),
      ),
    ).toBe("203.0.113.5");
    expect(resolver.resolve("10.1.1.1", headers({ "x-forwarded-for": "garbage, 10.2.2.2" }))).toBe(
      "10.2.2.2",
    );
    expect(
      resolver.resolve("::ffff:10.1.1.1", headers({ "x-forwarded-for": "[2001:db8::1]:443" })),
    ).toBe("2001:db8::1");
  });

  it("reads any other header as one address", () => {
    const real = createClientAddressResolver({
      trustedProxies: [{ address: "127.0.0.1", prefix: 32, family: "ipv4" }],
      header: "x-real-ip",
    });
    expect(real.resolve("127.0.0.1", headers({ "x-real-ip": "203.0.113.5:1234" }))).toBe(
      "203.0.113.5",
    );
    expect(real.resolve("127.0.0.1", headers({ "x-real-ip": "nonsense" }))).toBe("127.0.0.1");
    expect(real.isTrusted("127.0.0.1")).toBe(true);
    expect(real.isTrusted("203.0.113.5")).toBe(false);
    expect(real.isTrusted(undefined)).toBe(false);
  });

  it("normalizes mapped addresses and accepts only ids that look like one", () => {
    expect(normalizeAddress("::ffff:192.0.2.1")).toBe("192.0.2.1");
    expect(normalizeAddress("2001:db8::1")).toBe("2001:db8::1");
    expect(acceptRequestId("req-123:abc/x=y")).toBe("req-123:abc/x=y");
    expect(acceptRequestId("a b")).toBeUndefined();
    expect(acceptRequestId("x".repeat(129))).toBeUndefined();
    expect(acceptRequestId(null)).toBeUndefined();
  });
});
