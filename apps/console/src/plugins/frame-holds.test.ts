import { describe, expect, it } from "vitest";
import { frameFile, frameHoldsOf } from "./frame-holds.js";

const SCRIPT = "text/javascript; charset=utf-8";
const bytes = new TextEncoder().encode("run();\n");
const text = (body: Uint8Array) => new TextDecoder().decode(body);

describe("what a plugin's frames hold (ADR-0066)", () => {
  it("is what its install holds, and changes where the plugin can go without it", () => {
    const webrtc = ["outbound:webrtc"];
    const asking = (capabilities: string[], optionalCapabilities: string[]) => ({
      capabilities,
      optionalCapabilities,
    });
    expect(frameHoldsOf(asking([], []), [])).toEqual({ webrtc: false, changing: false });
    expect(frameHoldsOf(asking(webrtc, []), webrtc)).toEqual({ webrtc: true, changing: false });
    expect(frameHoldsOf(asking([], webrtc), [])).toEqual({ webrtc: false, changing: true });
    expect(frameHoldsOf(asking([], webrtc), webrtc)).toEqual({ webrtc: true, changing: true });
  });

  it("opens nothing for what a version no longer asks, though it was consented to for one before", () => {
    const manifest = { capabilities: [], optionalCapabilities: [] };
    expect(frameHoldsOf(manifest, ["outbound:webrtc"])).toEqual({ webrtc: false, changing: false });
  });

  it("is not opened by a host", () => {
    const host = ["outbound:api.example.com"];
    const manifest = { capabilities: [], optionalCapabilities: host };
    expect(frameHoldsOf(manifest, host)).toEqual({ webrtc: false, changing: false });
  });

  it("begins every script by taking WebRTC out, unless the plugin holds it", () => {
    const held = frameFile(bytes, SCRIPT, { webrtc: true, changing: false });
    expect(text(held.body)).toBe("run();\n");
    const without = frameFile(bytes, SCRIPT, { webrtc: false, changing: false });
    expect(text(without.body).startsWith('if(typeof globalThis!=="object")')).toBe(true);
    expect(text(without.body).endsWith("\nrun();\n")).toBe(true);
  });

  it("keeps a script for its version, and nowhere where its first line can change", () => {
    const kept = "public, max-age=31536000, immutable";
    expect(frameFile(bytes, SCRIPT, { webrtc: true, changing: false }).cacheControl).toBe(kept);
    expect(frameFile(bytes, SCRIPT, { webrtc: false, changing: false }).cacheControl).toBe(kept);
    expect(frameFile(bytes, SCRIPT, { webrtc: true, changing: true }).cacheControl).toBe(
      "no-store",
    );
    expect(frameFile(bytes, SCRIPT, { webrtc: false, changing: true }).cacheControl).toBe(
      "no-store",
    );
  });

  it("leaves everything that is not a script as it is, kept for its version", () => {
    const style = frameFile(bytes, "text/css; charset=utf-8", { webrtc: false, changing: true });
    expect(text(style.body)).toBe("run();\n");
    expect(style.cacheControl).toBe("public, max-age=31536000, immutable");
  });
});
