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
import { CONSOLE_LANGUAGES, languagesFirst } from "../vocabulary.js";
import { pluginEventsReaderOf } from "./plugin-events.js";
import { cx, Spinner } from "./ui.js";
import { weekStartOf } from "./workspace.js";

// A plugin's page or widget on the console's page (ADR-0054, docs/specs/plugins.md, "Pages"):
// a sandboxed frame whose document the console serves, and the console's side of the bridge.
// The frame speaks over postMessage alone; this component accepts the frame's window alone,
// performs every call under the plugin's own routes with the person's session, and refuses the
// rest before any request. Nothing the frame says is rendered as HTML.

/** How tall a page's frame may grow: far above any page, below what would break the layout. */
const MAX_PAGE_HEIGHT = 20_000;
/**
 * How long after a frame has loaded, or said it is ready, the spinner stands in its place when
 * the page has not grown: a page that draws nothing to measure, or says no height.
 */
const DRAW_WAIT_MS = 5_000;

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
 * Whether a person pressed something in this frame a moment ago, as far as the page can tell, for
 * a bundle built before 0.4.6, which asks the page to open its links (ADR-0067). The browser
 * keeps a press for the whole page, wherever it was, so the page takes a press for the frame's
 * only while the frame holds the page's focus, which a press in it gives it and a press anywhere
 * else takes away. That is as far as a page sees into a frame: one that takes the focus itself is
 * not told apart, which is why a frame opens its own links since 0.4.6, held by the browser to a
 * press in it (ADR-0078). A browser without the API is left to decide for itself, as it does for
 * any page.
 */
function pressedIn(element: HTMLIFrameElement | null): boolean {
  if (typeof navigator === "undefined" || typeof document === "undefined" || element === null) {
    return false;
  }
  if (document.activeElement !== element) {
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
  /**
   * Whether the plugin's page has yet to draw: a spinner stands in the frame's place until the
   * page grows past the height it had before it drew anything, which it says first, or for a
   * while after the frame loaded, so that a page that draws nothing is shown as it is.
   */
  const [drawing, setDrawing] = useState(true);
  const drawWait = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const emptyHeight = useRef<number | undefined>(undefined);
  const subscribed = useRef<Set<BridgeEventKind>>(new Set());
  /** Whether the frame listens for the plugin's own events, as it said with `subscribe`. */
  const [hearing, setHearing] = useState(false);
  const ready = useRef(false);
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
  useEffect(() => {
    setUnavailable(false);
    setDrawing(true);
    emptyHeight.current = undefined;
    clearTimeout(drawWait.current);
    setHearing(false);
  }, [src]);
  useEffect(() => () => clearTimeout(drawWait.current), []);
  const drawn = useCallback(() => {
    clearTimeout(drawWait.current);
    setDrawing(false);
  }, []);
  /** The page is shown as it stands a while from now, whether or not it says a height by then. */
  const drawnSoon = useCallback(() => {
    clearTimeout(drawWait.current);
    drawWait.current = setTimeout(() => setDrawing(false), DRAW_WAIT_MS);
  }, []);

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
          drawnSoon();
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
              language: me.workspace.language ?? CONSOLE_LANGUAGES[0],
              languages: languagesFirst(me.workspace.language ?? CONSOLE_LANGUAGES[0]),
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
          // The first height is the empty page's, said before the page drew anything, its own
          // padding included; a greater one is the page drawn.
          if (emptyHeight.current === undefined) {
            emptyHeight.current = message.height;
          } else if (message.height > emptyHeight.current) {
            drawn();
          }
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
          // A link a frame built before 0.4.6 asks the page to open (ADR-0067): a web or a mail
          // address, in a new tab with no opener and no referrer, while a press is recent and the
          // frame holds the focus, which the page takes back as it opens one, so that another tab
          // takes another press. A frame since opens its own links, held to a press in it by the
          // browser (ADR-0078); the page stops hearing this at the next line.
          if (isOpenableFrom(message.url, window.location.origin) && pressedIn(frame.current)) {
            window.open(message.url, "_blank", "noopener,noreferrer");
            frame.current?.blur();
          }
          return;
        case "subscribe":
          subscribed.current = new Set(message.kinds);
          setHearing(message.kinds.includes("plugin"));
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

  // The plugin's own events, while the frame listens for them: heard through the one reader of
  // the plugin's events on the page, which its other frames share, from where the stream stood
  // when the first of them listened.
  useEffect(() => {
    if (!hearing) {
      return;
    }
    return pluginEventsReaderOf(client, plugin.key).listen((event) => {
      post({ v: PLUGIN_BRIDGE_VERSION, t: "event", kind: "plugin", data: event });
    });
  }, [hearing, client, plugin.key, post]);

  if (unavailable) {
    return <p className="sc-plugin-frame-unavailable">{words.frameUnavailable}</p>;
  }
  return (
    <div
      className={cx(
        "sc-plugin-frame-box",
        !isWidget && "sc-plugin-frame-box-page",
        drawing && "sc-plugin-frame-loading",
      )}
      style={isWidget ? undefined : { height: `${height}px` }}
    >
      <iframe
        ref={frame}
        className={
          isWidget
            ? "sc-plugin-frame sc-plugin-frame-widget"
            : "sc-plugin-frame sc-plugin-frame-page"
        }
        src={src}
        title={props.title}
        // As the document's own policy says: scripts; forms firing their submit event, which the
        // policy's form-action 'none' keeps from going anywhere; and a window for a link a person
        // pressed in the frame, which the browser holds to the press (ADR-0078), opened out of the
        // sandbox so that the page it shows is a page as any.
        sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="origin"
        // Loaded, with its scripts run: a page that never says it is ready is shown as it is.
        onLoad={drawnSoon}
      />
      {drawing && (
        <div className="sc-plugin-frame-wait">
          <Spinner label={pack.common.loading} />
        </div>
      )}
    </div>
  );
}
