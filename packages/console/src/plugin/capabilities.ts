// The catalogue of what a plugin may ask of a console (docs/specs/plugins.md, "Capabilities"):
// declared in the manifest, consented to by an administrator when the plugin is enabled, enforced
// by the parent on every call. Each carries the sentence an administrator reads before consenting,
// and the reach of a plugin that turns out malicious and holds it.

/** The capabilities that take no parameter. */
export const PLUGIN_CAPABILITIES = [
  "files",
  "people:read",
  "people:read:all",
  "people:read:email",
  "people:act",
  "projects:read",
  "projects:read:all",
  "board:read",
  "board:tasks",
  "board:decisions",
  "board:documents",
  "events:console",
  "events:plugins",
  "jobs",
  "endpoints",
  "storage:sql",
  "outbound:webrtc",
] as const;

export type PluginCapability = (typeof PLUGIN_CAPABILITIES)[number];

/**
 * WebRTC on a plugin's pages (ADR-0066). It stands with `outbound:<host>` as a way to the internet,
 * and it is no host: a connection goes from a person's browser to any address a page names, which
 * no host could bound, so that consent to a host does not open it, and it opens no host.
 */
export const OUTBOUND_WEBRTC: PluginCapability = "outbound:webrtc";

/** The capabilities that carry a parameter: a host to reach, a plugin to call. */
export const PLUGIN_CAPABILITY_PREFIXES = ["outbound:", "plugins:"] as const;

/** A host as `outbound:<host>` names one: a name, or `*.` before a name for its subdomains. Never a port, never a path. */
const OUTBOUND_HOST = /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const PLUGIN_KEY = /^[a-z][a-z0-9-]{1,31}$/;

export interface CapabilityWords {
  /** What it opens, as the administrator reads it before consenting. */
  readonly opens: string;
  /** The reach of a plugin that turns out malicious and holds it. */
  readonly reach: string;
}

/** What each capability opens and what it risks, in the words of the specification. */
export const CAPABILITY_WORDS: Readonly<Record<PluginCapability, CapabilityWords>> = {
  files: {
    opens: "files on its records, within the bytes the deployment allows a plugin",
    reach: "storage filled to the bound",
  },
  "people:read": {
    opens: "the people the caller may see, as the person",
    reach: "the names and logins its role holders may see anyway",
  },
  "people:read:all": {
    opens: "everyone in the workspace, for its jobs and hooks too",
    reach: "the directory",
  },
  "people:read:email": {
    opens: "the work email of the people it may read, to match them to accounts elsewhere",
    reach: "the addresses of the people its role holders may see",
  },
  "people:act": {
    opens:
      "acting for a person who did something elsewhere: a command run and a decision answered as them, within what they may do, recorded as theirs through the plugin",
    reach: "what its role holders may do, done in their name from elsewhere",
  },
  "projects:read": {
    opens: "the projects and members the caller may see",
    reach: "what the person sees",
  },
  "projects:read:all": {
    opens: "every project and its members",
    reach: "the projects and who is in them",
  },
  "board:read": {
    opens:
      "the tasks, decisions, runs, documents and events of its board projects, and of the project a call is on",
    reach: "the content of those boards, to its role holders",
  },
  "board:tasks": {
    opens: "tasks created in its projects; its own changed, closed and commented",
    reach: "tasks that mislead; each marked as the plugin's, put away by anyone",
  },
  "board:decisions": {
    opens: "decisions raised in its projects; the answers to its own read",
    reach: "questions that mislead; never an answer",
  },
  "board:documents": {
    opens: "pages written under plugins/<key>/ in its projects",
    reach: "pages that mislead, in its folder",
  },
  "events:console": {
    opens: "hooks on the console's events of its board projects",
    reach: "when things happen on those boards",
  },
  "events:plugins": {
    opens: "hooks on the events other plugins emit",
    reach: "what they publish",
  },
  jobs: {
    opens: "runs on a schedule",
    reach: "time, within the bound",
  },
  endpoints: {
    opens: "inbound requests under its path, a person's or a webhook's",
    reach: "input it accepts without verifying; the rate limit holds",
  },
  "storage:sql": {
    opens: "a schema and a login role of its own in the console's database",
    reach: "statements up to the timeout, within its schema",
  },
  "outbound:webrtc": {
    opens: "WebRTC on its pages: connections from each person's browser to any address",
    reach: "what its pages are shown, sent anywhere from the person's browser; their address",
  },
};

/** True for a capability the catalogue knows, parameter included. */
export function isPluginCapability(value: string): boolean {
  if ((PLUGIN_CAPABILITIES as readonly string[]).includes(value)) {
    return true;
  }
  if (value.startsWith("outbound:")) {
    return OUTBOUND_HOST.test(value.slice("outbound:".length));
  }
  if (value.startsWith("plugins:")) {
    return PLUGIN_KEY.test(value.slice("plugins:".length));
  }
  return false;
}

/** The sentences for a capability, parameter included; nothing for one the catalogue does not know. */
export function capabilityWords(capability: string): CapabilityWords | undefined {
  if ((PLUGIN_CAPABILITIES as readonly string[]).includes(capability)) {
    return CAPABILITY_WORDS[capability as PluginCapability];
  }
  if (capability.startsWith("outbound:") && isPluginCapability(capability)) {
    const host = capability.slice("outbound:".length);
    return {
      opens: `requests to ${host}, a public address, over https`,
      reach: `what it may read, sent to ${host}; a cost there`,
    };
  }
  if (capability.startsWith("plugins:") && isPluginCapability(capability)) {
    const key = capability.slice("plugins:".length);
    return {
      opens: `the API of the plugin ${key}, as the caller`,
      reach: "what that API gives the caller",
    };
  }
  return undefined;
}

/** True when the request's host is within what `outbound:<host>` names: the host itself, or a subdomain where the capability starts with `*.`. */
export function outboundAllows(capability: string, host: string): boolean {
  if (
    !capability.startsWith("outbound:") ||
    capability === OUTBOUND_WEBRTC ||
    !isPluginCapability(capability)
  ) {
    return false;
  }
  const named = capability.slice("outbound:".length);
  const lower = host.toLowerCase();
  if (named.startsWith("*.")) {
    const domain = named.slice(2);
    return lower.endsWith(`.${domain}`) && lower.length > domain.length + 1;
  }
  return lower === named;
}
