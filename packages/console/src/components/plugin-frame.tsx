import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConsoleClient, PluginClient } from "../client.js";
import { firstDayOfWeek } from "../dates.js";
import type { Messages } from "../i18n/en.js";
import { useWords } from "../i18n/index.js";
import type { PluginWidgetSizeName } from "../plugin/bridge.js";
import {
  type BridgeCall,
  type BridgeEventKind,
  type BridgeToFrame,
  isBridgePath,
  isBridgeToPage,
  isOpenableFrom,
  PLUGIN_BRIDGE_VERSION,
} from "../plugin/bridge.js";
import type { Navigation } from "../router.js";
import type { RestEvent, RestMe, RestPlugin, RestProject } from "../schemas.js";
import { CONSOLE_TOKENS } from "../tokens.js";
import { wordsForFailure } from "../use-action.js";
import { CONSOLE_LANGUAGES } from "../vocabulary.js";
import { weekStartOf } from "./workspace.js";

// A plugin's page or widget on the console's page (ADR-0054, docs/specs/plugins.md, "Pages"):
// a sandboxed frame whose document the console serves, and the console's side of the bridge.
// The frame speaks over postMessage alone; this component accepts the frame's window alone,
// performs every call under the plugin's own routes with the person's session, and refuses the
// rest before any request. Nothing the frame says is rendered as HTML.

/** How tall a page's frame may grow: far above any page, below what would break the layout. */
const MAX_PAGE_HEIGHT = 20_000;
/** How often the plugin's own events are asked for while a frame listens for them. */
const EVENTS_POLL_MS = 5_000;

export interface PluginFrameProps {
  readonly plugin: RestPlugin;
  /** The page shown, or the widget; one of the two. */
  readonly page?: string | undefined;
  readonly widget?: string | undefined;
  /** The size the widget has (ADR-0059), told to the frame at the start and when it changes. */
  readonly size?: PluginWidgetSizeName | undefined;
  /** The project the page is on, or nothing on the workspace. */
  readonly project?: RestProject | undefined;
  /** What follows the page in the address, handed to the frame. */
  readonly path?: string | undefined;
  readonly me: RestMe;
  readonly language: string;
  readonly client: ConsoleClient;
  readonly navigation: Navigation;
  /** The project's feed, for the frame to hear of the plugin's commands; none on the workspace. */
  readonly events?: readonly RestEvent[] | undefined;
  /** What the frame is called, for assistive technology. */
  readonly title: string;
}

/** A refusal of the bridge, as the frame receives it: the console's code and a message. */
export class BridgeRefusal extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BridgeRefusal";
    this.code = code;
  }
}

const text = (value: unknown, what: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new BridgeRefusal("plugin.invalid_args", `${what} is text`);
  }
  return value;
};

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * Performs one `call` of the frame through the plugin's own routes and nothing else: a command,
 * a query, the records, the files. The answer, and what to transfer with it; a method the bridge
 * does not know, or a request outside the plugin, is refused before anything is sent.
 */
export async function performBridgeCall(
  plugin: PluginClient,
  projectKey: string | undefined,
  call: BridgeCall,
): Promise<{ readonly value: unknown; readonly transfer?: Transferable[] }> {
  const params = record(call.params);
  const project = projectKey === undefined ? {} : { project: projectKey };
  switch (call.method) {
    case "command": {
      const name = text(params.name, "name");
      return {
        value: await plugin.command(name, { args: record(params.args), ...project }),
      };
    }
    case "query": {
      const name = text(params.name, "name");
      return { value: await plugin.query(name, record(params.args), project) };
    }
    case "records.list": {
      const collection = text(params.collection, "collection");
      return {
        value: await plugin.records(collection, {
          where: params.where === undefined ? undefined : record(params.where),
          order: typeof params.order === "string" ? params.order : undefined,
          limit: typeof params.limit === "number" ? params.limit : undefined,
          after: typeof params.after === "string" ? params.after : undefined,
          q: typeof params.q === "string" ? params.q : undefined,
          project: typeof params.project === "string" ? params.project : undefined,
        }),
      };
    }
    case "records.get": {
      const collection = text(params.collection, "collection");
      const id = text(params.id, "id");
      return {
        value: await plugin.record(
          collection,
          id,
          typeof params.version === "number" ? params.version : undefined,
        ),
      };
    }
    case "records.versions": {
      const collection = text(params.collection, "collection");
      const id = text(params.id, "id");
      return { value: (await plugin.recordVersions(collection, id)).items };
    }
    case "files.get": {
      const id = text(params.id, "id");
      const file = await plugin.readFile(id);
      const bytes = new Uint8Array(file.bytes).buffer;
      return {
        value: { name: file.name, type: file.contentType, bytes },
        transfer: [bytes],
      };
    }
    case "people.picture": {
      const id = text(params.id, "id");
      const picture = await plugin.personPicture(id);
      const bytes = new Uint8Array(picture.bytes).buffer;
      return { value: { type: picture.contentType, bytes }, transfer: [bytes] };
    }
    case "files.put": {
      const name = text(params.name, "name");
      const type = text(params.type, "type");
      const bytes = params.bytes;
      if (!(bytes instanceof ArrayBuffer)) {
        throw new BridgeRefusal("plugin.invalid_args", "bytes is an ArrayBuffer");
      }
      const handle = await plugin.upload({ name, bytes: new Uint8Array(bytes), contentType: type });
      return { value: { handle: handle.handle } };
    }
    default:
      throw new BridgeRefusal(
        "plugin.forbidden",
        `${String(call.method)} is not a method of the bridge`,
      );
  }
}

/** The console's computed design tokens, as the page's root has them: what a frame is told to look like. */
/**
 * Whether a person pressed something a moment ago, as the browser keeps it: a link in a frame
 * gives the page this too, which is what lets the page open a tab for it; a browser without the
 * API is left to decide for itself, as it does for any page.
 */
function recentlyPressed(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } })
    .userActivation;
  return activation === undefined || activation.isActive;
}

export function readTheme(): Record<string, string> {
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") {
    return {};
  }
  const style = getComputedStyle(document.documentElement);
  const theme: Record<string, string> = {};
  for (const token of CONSOLE_TOKENS) {
    const value = style.getPropertyValue(token).trim();
    if (value.length > 0) {
      theme[token] = value.slice(0, 200);
    }
  }
  return theme;
}

/**
 * What a failure of a call says to the frame: the code, with the console's own refusals in the
 * person's language, a plugin's own in its own words; or the console's own failure.
 */
function errorOf(
  error: unknown,
  pack: Messages,
): { readonly code: string; readonly message: string } {
  if (error instanceof BridgeRefusal) {
    return { code: error.code, message: error.message };
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return { code: error.code, message: wordsForFailure(error, pack) ?? error.message };
  }
  return { code: "plugin.failed", message: "the call failed" };
}

export function PluginFrame(props: PluginFrameProps) {
  const { plugin, page, widget, project, me, language, client, navigation, events } = props;
  const pack = useWords();
  const words = pack.plugins;
  const frame = useRef<HTMLIFrameElement>(null);
  const isWidget = widget !== undefined;
  const [height, setHeight] = useState(480);
  /** Whether the console served the frame nothing to show: a plugin turned off since the page read it, say. */
  const [unavailable, setUnavailable] = useState(false);
  const subscribed = useRef<Set<BridgeEventKind>>(new Set());
  const ready = useRef(false);
  const lastPluginEvent = useRef(0);
  const seenEvents = useRef(0);
  const path = props.path ?? "";
  const scoped = useMemo(() => client.plugin(plugin.key), [client, plugin.key]);
  const src = useMemo(
    () =>
      scoped.frameUrl({
        ...(page === undefined ? {} : { page }),
        ...(widget === undefined ? {} : { widget }),
        ...(project === undefined ? {} : { project: project.key }),
      }),
    [scoped, page, widget, project],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: another address is another document
  useEffect(() => setUnavailable(false), [src]);

  const post = useCallback((message: BridgeToFrame, transfer?: Transferable[]) => {
    // The frame's origin is opaque, so the target is any: the frame itself checks the sender.
    frame.current?.contentWindow?.postMessage(message, "*", transfer ?? []);
  }, []);

  // The frame's messages: from its own window alone, each as the bridge spells it.
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const onMessage = (event: MessageEvent) => {
      const target = frame.current?.contentWindow;
      if (target === null || target === undefined || event.source !== target) {
        return;
      }
      if (!isBridgeToPage(event.data)) {
        return;
      }
      const message = event.data;
      switch (message.t) {
        case "unavailable":
          setUnavailable(true);
          return;
        case "ready":
          ready.current = true;
          post({
            v: PLUGIN_BRIDGE_VERSION,
            t: "init",
            plugin: { key: plugin.key, version: plugin.version },
            ...(page === undefined ? {} : { page }),
            ...(widget === undefined ? {} : { widget }),
            ...(props.size === undefined ? {} : { size: props.size }),
            project: project === undefined ? null : { key: project.key, name: project.name },
            person: {
              id: me.person?.id ?? "",
              login: me.person?.login ?? "",
              name: me.person?.name ?? null,
              language,
              admin: me.person?.role === "admin",
            },
            workspace: {
              name: me.workspace.name,
              languages: [...CONSOLE_LANGUAGES],
              timeZone: me.workspace.timeZone ?? "UTC",
              weekStart: weekStartOf(me.workspace),
              firstDay: firstDayOfWeek(language, weekStartOf(me.workspace)),
            },
            roles: plugin.roles,
            path,
            language,
            theme: readTheme(),
          });
          return;
        case "call":
          void performBridgeCall(scoped, project?.key, message)
            .then(({ value, transfer }) =>
              post(
                { v: PLUGIN_BRIDGE_VERSION, t: "result", id: message.id, ok: true, value },
                transfer,
              ),
            )
            .catch((error: unknown) =>
              post({
                v: PLUGIN_BRIDGE_VERSION,
                t: "result",
                id: message.id,
                ok: false,
                error: errorOf(error, pack),
              }),
            );
          return;
        case "navigate":
          if (isBridgePath(message.path)) {
            navigation.go(message.path);
          }
          return;
        case "resize":
          // A widget fills the cells its size gives it (ADR-0059); a page is as tall as it asks.
          if (!isWidget) {
            setHeight(Math.max(40, Math.min(Math.ceil(message.height), MAX_PAGE_HEIGHT)));
          }
          return;
        case "title":
          if (!isWidget && typeof document !== "undefined") {
            document.title = message.text;
          }
          return;
        case "download": {
          const anchor = document.createElement("a");
          anchor.href = scoped.fileUrl(message.id);
          anchor.download = "";
          anchor.rel = "noopener";
          anchor.click();
          return;
        }
        case "open":
          // A link a person pressed in the frame (ADR-0067): a web or a mail address, opened in a
          // new tab with no opener and no referrer, and only while the press is recent, which a
          // press in the frame gives this page too.
          if (isOpenableFrom(message.url, window.location.origin) && recentlyPressed()) {
            window.open(message.url, "_blank", "noopener,noreferrer");
          }
          return;
        case "subscribe":
          subscribed.current = new Set(message.kinds);
          return;
        default:
          return;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  });

  // The console's look and language reach the frame as they change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the language is the trigger; the tokens change with it
  useEffect(() => {
    if (ready.current) {
      post({ v: PLUGIN_BRIDGE_VERSION, t: "theme", theme: readTheme() });
    }
  }, [language, post]);

  // The address moved within the page: the frame is told what follows the page now.
  useEffect(() => {
    if (ready.current) {
      post({ v: PLUGIN_BRIDGE_VERSION, t: "path", path });
    }
  }, [path, post]);

  // The person gave the widget another size: the frame lays itself out for it.
  const size = props.size;
  useEffect(() => {
    if (ready.current && size !== undefined) {
      post({ v: PLUGIN_BRIDGE_VERSION, t: "size", size });
    }
  }, [size, post]);

  // The plugin's commands, as the project's feed tells of them: a frame that listens hears of each.
  useEffect(() => {
    if (events === undefined) {
      return;
    }
    const fresh = events.slice(seenEvents.current);
    seenEvents.current = events.length;
    if (!ready.current) {
      return;
    }
    for (const event of fresh) {
      if (event.kind === "plugin.command" && event.plugin === plugin.key) {
        if (subscribed.current.has("command")) {
          post({ v: PLUGIN_BRIDGE_VERSION, t: "event", kind: "command", data: event.data });
        }
        if (subscribed.current.has("records")) {
          post({ v: PLUGIN_BRIDGE_VERSION, t: "event", kind: "records", data: event.data });
        }
      }
    }
  }, [events, plugin.key, post]);

  // The plugin's own events, asked for while a frame listens for them.
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const timer = setInterval(() => {
      if (!ready.current || !subscribed.current.has("plugin")) {
        return;
      }
      scoped
        .pluginEvents({ after: lastPluginEvent.current, limit: 50 })
        .then((page) => {
          for (const event of page.items) {
            lastPluginEvent.current = Math.max(lastPluginEvent.current, event.id);
            post({ v: PLUGIN_BRIDGE_VERSION, t: "event", kind: "plugin", data: event });
          }
        })
        .catch(() => undefined);
    }, EVENTS_POLL_MS);
    return () => clearInterval(timer);
  }, [scoped, post]);

  // What the plugin emitted before the frame came is not replayed: the stream is read from now.
  useEffect(() => {
    scoped
      .pluginEvents({ after: 0, limit: 1 })
      .then((page) => {
        if (page.more || page.items.length > 0) {
          // The newest number is past the first page; a frame hears of what comes after it listens.
          return scoped.pluginEvents({ after: 0, limit: 200 }).then((all) => {
            lastPluginEvent.current = all.items.at(-1)?.id ?? 0;
          });
        }
        return undefined;
      })
      .catch(() => undefined);
  }, [scoped]);

  if (unavailable) {
    return <p className="sc-plugin-frame-unavailable">{words.frameUnavailable}</p>;
  }
  return (
    <iframe
      ref={frame}
      className={
        isWidget ? "sc-plugin-frame sc-plugin-frame-widget" : "sc-plugin-frame sc-plugin-frame-page"
      }
      src={src}
      title={props.title}
      // As the document's own policy says: scripts, and forms firing their submit event, which
      // the policy's form-action 'none' keeps from going anywhere.
      sandbox="allow-scripts allow-forms"
      referrerPolicy="origin"
      style={isWidget ? undefined : { height: `${height}px` }}
    />
  );
}
