import { describe, expect, it } from "vitest";
import { capabilityWords, isPluginCapability, outboundAllows } from "./capabilities.js";

describe("the outbound capabilities", () => {
  it("name a host, or a subdomain of one, and nothing else", () => {
    expect(isPluginCapability("outbound:api.example.com")).toBe(true);
    expect(isPluginCapability("outbound:*.example.com")).toBe(true);
    for (const value of ["outbound:", "outbound:*", "outbound:localhost", "outbound:a.b:443"]) {
      expect(isPluginCapability(value)).toBe(false);
    }
    expect(outboundAllows("outbound:api.example.com", "API.example.com")).toBe(true);
    expect(outboundAllows("outbound:api.example.com", "other.example.com")).toBe(false);
    expect(outboundAllows("outbound:*.example.com", "api.example.com")).toBe(true);
    expect(outboundAllows("outbound:*.example.com", "example.com")).toBe(false);
  });

  it("name WebRTC in the family, which is no host and opens none (ADR-0066)", () => {
    expect(isPluginCapability("outbound:webrtc")).toBe(true);
    for (const value of ["outbound:WebRTC", "outbound:webrtc.", "outbound:webrtc:*"]) {
      expect(isPluginCapability(value)).toBe(false);
    }
    expect(outboundAllows("outbound:webrtc", "webrtc")).toBe(false);
    expect(outboundAllows("outbound:webrtc", "api.example.com")).toBe(false);
    expect(capabilityWords("outbound:webrtc")?.opens).toContain("any address");
  });
});
