// The frame's side of the bridge (docs/specs/plugins.md, "The bridge"): what a plugin's page
// bundles to speak to the console's page. It depends on nothing, speaks to the origin the frame
// document names alone, performs its plugin's own calls and nothing else, applies the console's
// tokens to the document, and says its height. A framework is the plugin's choice; this is below
// any.
import {
  BRIDGE_METHODS,
  type BridgeCommandResult,
  type BridgeError,
  type BridgeEventKind,
  type BridgeFile,
  type BridgeInit,
  type BridgeMethod,
  type BridgePicture,
  type BridgeToPage,
  isBridgePath,
  isBridgeToFrame,
  MAX_BRIDGE_TITLE_LENGTH,
  PLUGIN_BRIDGE_VERSION,
  type PluginWidgetSizeName,
} from "./bridge.js";
import type { PluginRecord, RecordPage, RecordVersion } from "./context.js";

/** What the console told the frame: who looks, at what, in which words. */
export type PluginFrameContext = Omit<BridgeInit, "v" | "t">;

/** A refusal from the console, with its stable code, as the page relayed it. */
export class PluginBridgeError extends Error {
  readonly code: string;
  readonly data: unknown;

  constructor(error: BridgeError) {
    super(error.message);
    this.name = "PluginBridgeError";
    this.code = error.code;
    this.data = error.data;
  }
}

export interface FrameMessageEvent {
  readonly data: unknown;
  readonly origin: string;
  readonly source: unknown;
}

/** As much of `window` as the bridge uses; a test hands one of its own. */
export interface FrameWindow {
  readonly parent: {
    postMessage(message: unknown, targetOrigin: string, transfer?: Transferable[]): void;
  };
  addEventListener(type: "message", listener: (event: FrameMessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: FrameMessageEvent) => void): void;
}

/** As much of `document` as the bridge uses. */
export interface FrameDocument {
  readonly documentElement: {
    readonly dataset: Readonly<Record<string, string | undefined>>;
    readonly style: { setProperty(name: string, value: string): void };
    lang: string;
  };
  readonly body: { readonly scrollHeight: number } | null;
  title: string;
}

export interface ConnectOptions {
  readonly window?: FrameWindow;
  readonly document?: FrameDocument;
  /** How long to wait for the console's `init`; ten seconds unless said. */
  readonly timeoutMs?: number;
  /** Whether the frame says its height as it changes; on unless said otherwise. */
  readonly resize?: boolean;
}

export interface FrameRecordsQuery {
  readonly where?: Readonly<Record<string, unknown>>;
  /** A field of the collection's indexes, `-` before it for descending. */
  readonly order?: string;
  readonly limit?: number;
  readonly after?: string;
  readonly q?: string;
  readonly project?: string;
}

/** The frame's connection to the console's page. */
export interface PluginFrame {
  readonly context: PluginFrameContext;
  /** A call as the bridge carries one; the typed methods below are the usual way. */
  call(method: BridgeMethod, params: Readonly<Record<string, unknown>>): Promise<unknown>;
  command(name: string, args?: Readonly<Record<string, unknown>>): Promise<BridgeCommandResult>;
  query(name: string, args?: Readonly<Record<string, unknown>>): Promise<unknown>;
  readonly records: {
    list<T = Record<string, unknown>>(
      collection: string,
      query?: FrameRecordsQuery,
    ): Promise<RecordPage<T>>;
    get<T = Record<string, unknown>>(
      collection: string,
      id: string,
      version?: number,
    ): Promise<PluginRecord<T>>;
    versions<T = Record<string, unknown>>(
      collection: string,
      id: string,
    ): Promise<readonly RecordVersion<T>[]>;
  };
  readonly files: {
    get(id: string): Promise<BridgeFile>;
    /** Uploads bytes for a command; answers the handle, good for an hour. */
    put(
      bytes: ArrayBuffer | Uint8Array,
      name: string,
      type: string,
    ): Promise<{ readonly handle: string }>;
  };
  readonly people: {
    /**
     * An address to put in an image, of the person of that id (ADR-0063), with `people:read`; or
     * `null` for a person with no picture to show. Kept for the life of the frame.
     */
    picture(id: string): Promise<string | null>;
  };
  /** The console's page follows a path of the console's in place; a URL is refused. */
  navigate(path: string): void;
  /** The console's page downloads a file of this plugin. */
  download(id: string): void;
  setTitle(text: string): void;
  /** Something of this plugin changed; subscribes to the kinds named. The function returned stops listening. */
  onEvent(
    kinds: readonly BridgeEventKind[],
    handler: (kind: BridgeEventKind, data: unknown) => void,
  ): () => void;
  /** The console's look changed; the tokens are applied before the handler runs. */
  onTheme(handler: (theme: Readonly<Record<string, string>>) => void): () => void;
  /** The console navigated within this page's address. */
  onPath(handler: (path: string) => void): () => void;
  /** The person gave the widget another size (ADR-0059); `context.size` was the first. */
  onSize(handler: (size: PluginWidgetSizeName) => void): () => void;
  /** Stops listening to the console's page. */
  close(): void;
}

const DEFAULT_CONNECT_MS = 10_000;

/** What a page is told for a person with no picture to show, which is no failure of the page's. */
const NO_PICTURE: ReadonlySet<string> = new Set([
  "plugin.not_found",
  "picture.refused",
  "picture.unavailable",
]);

function globalWindow(): FrameWindow {
  const candidate = (globalThis as { window?: FrameWindow }).window;
  if (candidate === undefined) {
    throw new PluginBridgeError({
      code: "plugin.no_window",
      message: "connect() runs in a plugin's frame, where window is",
    });
  }
  return candidate;
}

function globalDocument(): FrameDocument {
  const candidate = (globalThis as { document?: FrameDocument }).document;
  if (candidate === undefined) {
    throw new PluginBridgeError({
      code: "plugin.no_window",
      message: "connect() runs in a plugin's frame, where document is",
    });
  }
  return candidate;
}

/** Sets the console's tokens on the document's root, `--sc-*` and nothing else. */
export function applyTheme(document: FrameDocument, theme: Readonly<Record<string, string>>): void {
  for (const [token, value] of Object.entries(theme)) {
    if (token.startsWith("--sc-")) {
      document.documentElement.style.setProperty(token, value);
    }
  }
}

function startHeightWatch(document: FrameDocument, post: (height: number) => void): () => void {
  const body = document.body;
  if (body === null) {
    return () => {};
  }
  let last = -1;
  const say = () => {
    const height = Math.ceil(body.scrollHeight);
    if (height !== last) {
      last = height;
      post(height);
    }
  };
  say();
  const observerClass = (
    globalThis as {
      ResizeObserver?: new (
        callback: () => void,
      ) => { observe(target: unknown): void; disconnect(): void };
    }
  ).ResizeObserver;
  const elementClass = (globalThis as { Element?: abstract new () => unknown }).Element;
  if (observerClass !== undefined && elementClass !== undefined && body instanceof elementClass) {
    const observer = new observerClass(say);
    observer.observe(body);
    return () => observer.disconnect();
  }
  const timer = setInterval(say, 500);
  return () => clearInterval(timer);
}

/**
 * Connects the frame to the console's page: says `ready`, waits for `init`, applies the tokens,
 * and answers the connection. Call it once, when the bundle starts.
 */
export function connect(options: ConnectOptions = {}): Promise<PluginFrame> {
  const win = options.window ?? globalWindow();
  const doc = options.document ?? globalDocument();
  const origin = doc.documentElement.dataset.console;
  if (origin === undefined || origin.length === 0) {
    return Promise.reject(
      new PluginBridgeError({
        code: "plugin.no_console",
        message: "the document names no console in data-console; this is not a plugin's frame",
      }),
    );
  }
  const post = (message: BridgeToPage, transfer?: Transferable[]) => {
    win.parent.postMessage(message, origin, transfer);
  };
  const pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  const eventHandlers = new Set<(kind: BridgeEventKind, data: unknown) => void>();
  const themeHandlers = new Set<(theme: Readonly<Record<string, string>>) => void>();
  const pathHandlers = new Set<(path: string) => void>();
  const sizeHandlers = new Set<(size: PluginWidgetSizeName) => void>();
  const subscribed = new Set<BridgeEventKind>();
  const pictures = new Map<string, Promise<string | null>>();
  let counter = 0;
  let stopHeight: (() => void) | undefined;

  return new Promise<PluginFrame>((resolveConnect, rejectConnect) => {
    let connected = false;
    const timer = setTimeout(() => {
      if (!connected) {
        win.removeEventListener("message", listener);
        rejectConnect(
          new PluginBridgeError({
            code: "plugin.no_init",
            message: `the console's page did not answer within ${options.timeoutMs ?? DEFAULT_CONNECT_MS} ms`,
          }),
        );
      }
    }, options.timeoutMs ?? DEFAULT_CONNECT_MS);

    const call = (
      method: BridgeMethod,
      params: Readonly<Record<string, unknown>>,
      transfer?: Transferable[],
    ): Promise<unknown> => {
      if (!(BRIDGE_METHODS as readonly string[]).includes(method)) {
        return Promise.reject(
          new PluginBridgeError({
            code: "plugin.forbidden",
            message: `${method} is not a method of the bridge`,
          }),
        );
      }
      counter += 1;
      const id = String(counter);
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        post({ v: PLUGIN_BRIDGE_VERSION, t: "call", id, method, params }, transfer);
      });
    };

    const listener = (event: FrameMessageEvent) => {
      if (event.source !== win.parent || event.origin !== origin || !isBridgeToFrame(event.data)) {
        return;
      }
      const message = event.data;
      switch (message.t) {
        case "init": {
          if (connected) {
            return;
          }
          connected = true;
          clearTimeout(timer);
          applyTheme(doc, message.theme);
          doc.documentElement.lang = message.language;
          const { v: _v, t: _t, ...context } = message;
          const frame: PluginFrame = {
            context,
            call: (method, params) => call(method, params),
            command: (name, args = {}) =>
              call("command", { name, args }) as Promise<BridgeCommandResult>,
            query: (name, args = {}) => call("query", { name, args }),
            records: {
              list: <T>(collection: string, query: FrameRecordsQuery = {}) =>
                call("records.list", { collection, ...query }) as Promise<RecordPage<T>>,
              get: <T>(collection: string, id: string, version?: number) =>
                call(
                  "records.get",
                  version === undefined ? { collection, id } : { collection, id, version },
                ) as Promise<PluginRecord<T>>,
              versions: <T>(collection: string, id: string) =>
                call("records.versions", { collection, id }) as Promise<
                  readonly RecordVersion<T>[]
                >,
            },
            files: {
              get: (id) => call("files.get", { id }) as Promise<BridgeFile>,
              put: (bytes, name, type) => {
                const buffer = bytes instanceof Uint8Array ? bytes.slice().buffer : bytes;
                return call("files.put", { bytes: buffer, name, type }, [buffer]) as Promise<{
                  handle: string;
                }>;
              },
            },
            people: {
              picture: (id) => {
                const kept = pictures.get(id);
                if (kept !== undefined) {
                  return kept;
                }
                const asked = (call("people.picture", { id }) as Promise<BridgePicture>).then(
                  ({ type, bytes }) => URL.createObjectURL(new Blob([bytes], { type })),
                  (error: unknown) => {
                    if (error instanceof PluginBridgeError && NO_PICTURE.has(error.code)) {
                      return null;
                    }
                    pictures.delete(id);
                    throw error;
                  },
                );
                pictures.set(id, asked);
                return asked;
              },
            },
            navigate: (path) => {
              if (!isBridgePath(path)) {
                throw new PluginBridgeError({
                  code: "plugin.forbidden",
                  message: "navigate takes a path of the console's, never a URL",
                });
              }
              post({ v: PLUGIN_BRIDGE_VERSION, t: "navigate", path });
            },
            download: (id) => post({ v: PLUGIN_BRIDGE_VERSION, t: "download", id }),
            setTitle: (text) => {
              const title = text.slice(0, MAX_BRIDGE_TITLE_LENGTH).replace(/[\r\n]+/g, " ");
              doc.title = title;
              post({ v: PLUGIN_BRIDGE_VERSION, t: "title", text: title });
            },
            onEvent: (kinds, handler) => {
              eventHandlers.add(handler);
              let added = false;
              for (const kind of kinds) {
                if (!subscribed.has(kind)) {
                  subscribed.add(kind);
                  added = true;
                }
              }
              if (added) {
                post({ v: PLUGIN_BRIDGE_VERSION, t: "subscribe", kinds: [...subscribed] });
              }
              return () => eventHandlers.delete(handler);
            },
            onTheme: (handler) => {
              themeHandlers.add(handler);
              return () => themeHandlers.delete(handler);
            },
            onPath: (handler) => {
              pathHandlers.add(handler);
              return () => pathHandlers.delete(handler);
            },
            onSize: (handler) => {
              sizeHandlers.add(handler);
              return () => sizeHandlers.delete(handler);
            },
            close: () => {
              win.removeEventListener("message", listener);
              stopHeight?.();
              for (const { reject } of pending.values()) {
                reject(
                  new PluginBridgeError({
                    code: "plugin.closed",
                    message: "the frame closed its connection",
                  }),
                );
              }
              pending.clear();
            },
          };
          if (options.resize !== false) {
            stopHeight = startHeightWatch(doc, (height) =>
              post({ v: PLUGIN_BRIDGE_VERSION, t: "resize", height }),
            );
          }
          resolveConnect(frame);
          return;
        }
        case "result": {
          const waiting = pending.get(message.id);
          if (waiting === undefined) {
            return;
          }
          pending.delete(message.id);
          if (message.ok) {
            waiting.resolve(message.value);
          } else {
            waiting.reject(
              new PluginBridgeError(
                message.error ?? { code: "plugin.failed", message: "the call failed" },
              ),
            );
          }
          return;
        }
        case "event":
          for (const handler of eventHandlers) {
            handler(message.kind, message.data);
          }
          return;
        case "theme":
          applyTheme(doc, message.theme);
          for (const handler of themeHandlers) {
            handler(message.theme);
          }
          return;
        case "path":
          for (const handler of pathHandlers) {
            handler(message.path);
          }
          return;
        case "size":
          for (const handler of sizeHandlers) {
            handler(message.size);
          }
          return;
        default:
          return;
      }
    };
    win.addEventListener("message", listener);
    post({ v: PLUGIN_BRIDGE_VERSION, t: "ready" });
  });
}
