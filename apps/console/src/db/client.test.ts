import { describe, expect, it } from "vitest";
import { sslOf } from "./client.js";

const PEM = "-----BEGIN CERTIFICATE-----\nMIIBAAAA\n-----END CERTIFICATE-----\n";

describe("sslOf", () => {
  it("checks the chain and the host name against the authority handed in", () => {
    expect(sslOf(PEM)).toEqual({ ca: PEM, rejectUnauthorized: true });
  });

  it("says nothing without one, so that the URL's own parameters decide", () => {
    expect(sslOf(undefined)).toBeUndefined();
  });
});
