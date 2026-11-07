import { OUTBOUND_WEBRTC } from "@skillcdn/console/plugin";

// What a plugin's frames hold beyond the bridge, and how they are made to hold no more (ADR-0066).
// A capability says what may be; this file alone says how that is held, so that a change in how a
// frame is isolated, a directive a browser comes to enforce, an origin of the frames' own, changes
// this file, and no manifest and no consent.

export interface FrameHolds {
  /** Whether the plugin's pages have WebRTC. */
  readonly webrtc: boolean;
  /** Whether that can change under one version: an administrator may turn it on and off. */
  readonly changing: boolean;
}

/**
 * What the frames of a plugin hold: from what this version asks, and what its install holds now.
 * A consent stays on the install when a new version stops asking; it opens nothing then, or that
 * version's scripts would be kept without the line, past any withdrawing.
 */
export function frameHoldsOf(
  manifest: {
    readonly capabilities: readonly string[];
    readonly optionalCapabilities: readonly string[];
  },
  consent: readonly string[],
): FrameHolds {
  const changing = manifest.optionalCapabilities.includes(OUTBOUND_WEBRTC);
  const asked = changing || manifest.capabilities.includes(OUTBOUND_WEBRTC);
  return { webrtc: asked && consent.includes(OUTBOUND_WEBRTC), changing };
}

/**
 * What every script of a bundle begins with where the plugin holds no WebRTC (ADR-0064): it goes
 * from wherever the script runs, the frame or a frame made inside it, before a line of the
 * plugin's. A file that shadows what this reads fails here, and none of it runs.
 */
const NO_WEBRTC = new TextEncoder().encode(
  'if(typeof globalThis!=="object")throw new Error("a script of a bundle may not shadow globalThis");' +
    "for(const name of Object.getOwnPropertyNames(globalThis))" +
    "if(/^(webkit)?RTC/.test(name))delete globalThis[name];\n",
);

/** A copy of a file kept for the year a version stays what it is. */
const KEPT = "public, max-age=31536000, immutable";

/**
 * A file of a bundle as a frame is served it, and how long it may be kept. A script whose first
 * line can change under one version is kept nowhere, or a browser or a cache on the way would go
 * on running one without the line after the capability is withdrawn.
 */
export function frameFile(
  bytes: Uint8Array,
  contentType: string,
  holds: FrameHolds,
): { readonly body: Uint8Array; readonly cacheControl: string } {
  if (!contentType.startsWith("text/javascript")) {
    return { body: bytes, cacheControl: KEPT };
  }
  return {
    body: holds.webrtc ? bytes : Buffer.concat([NO_WEBRTC, bytes]),
    cacheControl: holds.changing ? "no-store" : KEPT,
  };
}
