// The messages between the console's page and a plugin's frame (docs/specs/plugins.md, "The
// bridge"): every message `{ v: 1, t, ... }`, the page accepting the frame's window alone, the
// frame the console's origin alone. The shapes and their guards, with no DOM in them, so that the
// page's side and the frame's side read the same words and the tests need no browser.

import { WEEK_STARTS, type WeekStart } from "../vocabulary.js";

export const PLUGIN_BRIDGE_VERSION = 1;

/**
 * The sizes a widget comes in (ADR-0061): columns and rows of the front page's grid of square
 * cells, `small` 2×2, `medium` 4×2, `large` 4×4, `wide` 8×2, `full` 8×4. Here, so that a bundle
 * learns them without the manifest's schema.
 */
export const PLUGIN_WIDGET_SIZE_NAMES = ["small", "medium", "large", "wide", "full"] as const;
export type PluginWidgetSizeName = (typeof PLUGIN_WIDGET_SIZE_NAMES)[number];

/** What the frame may ask the page to perform, each under `/api/v1/plugins/<key>/` and nothing else. */
export const BRIDGE_METHODS = [
  "command",
  "query",
  "records.list",
  "records.get",
  "records.versions",
  "files.get",
  "files.put",
  "people.picture",
] as const;

export type BridgeMethod = (typeof BRIDGE_METHODS)[number];

/** The kinds of `event` a frame may subscribe to: its plugin's records changed, a command ran, the plugin emitted. */
export const BRIDGE_EVENT_KINDS = ["records", "command", "plugin"] as const;

export type BridgeEventKind = (typeof BRIDGE_EVENT_KINDS)[number];

export interface BridgePerson {
  readonly id: string;
  readonly login: string;
  readonly name: string | null;
  readonly language: string;
  readonly admin: boolean;
}

/** The workspace as a page lays itself out for it: what it is called, the languages it writes in, its clock and the day its week begins on. */
export interface BridgeWorkspace {
  readonly name: string;
  readonly languages: readonly string[];
  readonly timeZone: string;
  /** The workspace's setting (ADR-0035): `auto` leaves the week to the language of the pages. */
  readonly weekStart: WeekStart;
  /** The day a week begins on with the setting applied, for a calendar to start from: 1 for Monday, 7 for Sunday. */
  readonly firstDay: number;
}

/** What the page tells the frame once it is ready: who looks, at what, in which words and colours. */
export interface BridgeInit {
  readonly v: 1;
  readonly t: "init";
  readonly plugin: { readonly key: string; readonly version: string };
  readonly page?: string;
  readonly widget?: string;
  /** The size the widget's frame has (ADR-0059), one of the sizes the manifest declared for it; none for a page. */
  readonly size?: PluginWidgetSizeName;
  readonly project: { readonly key: string; readonly name: string } | null;
  readonly person: BridgePerson;
  /** The workspace; none from a console older than this. */
  readonly workspace?: BridgeWorkspace;
  readonly roles: readonly string[];
  /** What follows the page's key in the address. */
  readonly path: string;
  readonly language: string;
  /** The console's computed design tokens, `--sc-*`. */
  readonly theme: Readonly<Record<string, string>>;
}

export interface BridgeError {
  readonly code: string;
  readonly message: string;
  readonly data?: unknown;
}

export interface BridgeResult {
  readonly v: 1;
  readonly t: "result";
  readonly id: string;
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: BridgeError;
}

export interface BridgeEvent {
  readonly v: 1;
  readonly t: "event";
  readonly kind: BridgeEventKind;
  readonly data: unknown;
}

export interface BridgeTheme {
  readonly v: 1;
  readonly t: "theme";
  readonly theme: Readonly<Record<string, string>>;
}

export interface BridgePath {
  readonly v: 1;
  readonly t: "path";
  readonly path: string;
}

/** The person gave the widget another size (ADR-0059): the frame lays itself out for it. */
export interface BridgeSize {
  readonly v: 1;
  readonly t: "size";
  readonly size: PluginWidgetSizeName;
}

export type BridgeToFrame =
  | BridgeInit
  | BridgeResult
  | BridgeEvent
  | BridgeTheme
  | BridgePath
  | BridgeSize;

export interface BridgeReady {
  readonly v: 1;
  readonly t: "ready";
}

export interface BridgeCall {
  readonly v: 1;
  readonly t: "call";
  readonly id: string;
  readonly method: BridgeMethod;
  readonly params: unknown;
}

export interface BridgeNavigate {
  readonly v: 1;
  readonly t: "navigate";
  readonly path: string;
}

export interface BridgeResize {
  readonly v: 1;
  readonly t: "resize";
  readonly height: number;
}

export interface BridgeTitle {
  readonly v: 1;
  readonly t: "title";
  readonly text: string;
}

export interface BridgeDownload {
  readonly v: 1;
  readonly t: "download";
  readonly id: string;
}

/**
 * A link a person pressed in the frame, for the console's page to open in a new tab (ADR-0067):
 * the frame's sandbox opens no window itself, and the page opens one only for a web or a mail
 * address, and only right after a person pressed.
 */
export interface BridgeOpen {
  readonly v: 1;
  readonly t: "open";
  readonly url: string;
}

export interface BridgeSubscribe {
  readonly v: 1;
  readonly t: "subscribe";
  readonly kinds: readonly BridgeEventKind[];
}

/**
 * The frame has nothing to show: the plugin is off, or the page is not one of its own. The console
 * serves such a frame a document with no words, and the console's page says so in its own.
 */
export interface BridgeUnavailable {
  readonly v: 1;
  readonly t: "unavailable";
}

export type BridgeToPage =
  | BridgeReady
  | BridgeUnavailable
  | BridgeCall
  | BridgeNavigate
  | BridgeResize
  | BridgeTitle
  | BridgeDownload
  | BridgeOpen
  | BridgeSubscribe;

/** A path of the console's, as `navigate` and `path` carry one: absolute, no scheme, no host, one line. */
export const MAX_BRIDGE_PATH_LENGTH = 2048;
export const MAX_BRIDGE_TITLE_LENGTH = 200;
const MAX_ID_LENGTH = 128;
const MAX_THEME_TOKENS = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLine(value: unknown, max: number): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= max && !/[\r\n]/.test(value)
  );
}

/** True for a path the page may follow: within the console, never a URL. */
export function isBridgePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_BRIDGE_PATH_LENGTH &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !/[\s\\]/.test(value)
  );
}

/** The schemes a link pressed in a frame may open in a new tab: the web, and mail. Nothing that runs. */
const OPENABLE_SCHEMES: ReadonlySet<string> = new Set(["https:", "http:", "mailto:"]);
export const MAX_BRIDGE_URL_LENGTH = 2048;

/** True for an address the page may open in a new tab for a frame: an absolute web or mail address, one line. */
export function isBridgeUrl(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_BRIDGE_URL_LENGTH ||
    /\s/.test(value) ||
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f;
    }) ||
    !URL.canParse(value)
  ) {
    return false;
  }
  return OPENABLE_SCHEMES.has(new URL(value).protocol);
}

/**
 * True for an address the page opens for a frame (ADR-0067): a web or a mail address that is not
 * the console's own, given as `origin`, since a page of the console's is `navigate`'s, in the
 * person's tab.
 */
export function isOpenableFrom(value: unknown, origin: string): value is string {
  return isBridgeUrl(value) && new URL(value).origin !== origin;
}

function isTheme(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) {
    return false;
  }
  const entries = Object.entries(value);
  return (
    entries.length <= MAX_THEME_TOKENS &&
    entries.every(
      ([token, text]) =>
        /^--sc-[a-z0-9-]+$/.test(token) && typeof text === "string" && text.length <= 200,
    )
  );
}

function isWorkspace(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    Array.isArray(value.languages) &&
    value.languages.every((language) => typeof language === "string") &&
    isLine(value.timeZone, 100) &&
    (WEEK_STARTS as readonly unknown[]).includes(value.weekStart) &&
    typeof value.firstDay === "number" &&
    Number.isInteger(value.firstDay) &&
    value.firstDay >= 1 &&
    value.firstDay <= 7
  );
}

function isEnvelope(value: unknown): value is Record<string, unknown> & { t: string } {
  return isRecord(value) && value.v === PLUGIN_BRIDGE_VERSION && typeof value.t === "string";
}

/** True for a message the frame may act on, as the console's page sends them. */
export function isBridgeToFrame(value: unknown): value is BridgeToFrame {
  if (!isEnvelope(value)) {
    return false;
  }
  switch (value.t) {
    case "init":
      return (
        isRecord(value.plugin) &&
        isLine(value.plugin.key, 32) &&
        isLine(value.plugin.version, 64) &&
        (value.page === undefined || isLine(value.page, 32)) &&
        (value.widget === undefined || isLine(value.widget, 32)) &&
        (value.size === undefined ||
          (PLUGIN_WIDGET_SIZE_NAMES as readonly unknown[]).includes(value.size)) &&
        (value.project === null ||
          (isRecord(value.project) &&
            isLine(value.project.key, 64) &&
            typeof value.project.name === "string")) &&
        isRecord(value.person) &&
        typeof value.person.id === "string" &&
        typeof value.person.login === "string" &&
        (value.person.name === null || typeof value.person.name === "string") &&
        typeof value.person.language === "string" &&
        typeof value.person.admin === "boolean" &&
        (value.workspace === undefined || isWorkspace(value.workspace)) &&
        Array.isArray(value.roles) &&
        value.roles.every((role) => typeof role === "string") &&
        typeof value.path === "string" &&
        value.path.length <= MAX_BRIDGE_PATH_LENGTH &&
        typeof value.language === "string" &&
        isTheme(value.theme)
      );
    case "result":
      return (
        isLine(value.id, MAX_ID_LENGTH) &&
        typeof value.ok === "boolean" &&
        (value.error === undefined ||
          (isRecord(value.error) &&
            typeof value.error.code === "string" &&
            typeof value.error.message === "string"))
      );
    case "event":
      return (
        typeof value.kind === "string" &&
        (BRIDGE_EVENT_KINDS as readonly string[]).includes(value.kind)
      );
    case "theme":
      return isTheme(value.theme);
    case "path":
      return typeof value.path === "string" && value.path.length <= MAX_BRIDGE_PATH_LENGTH;
    case "size":
      return (PLUGIN_WIDGET_SIZE_NAMES as readonly unknown[]).includes(value.size);
    default:
      return false;
  }
}

/** True for a message the page may act on, as a frame sends them; anything else is dropped unread. */
export function isBridgeToPage(value: unknown): value is BridgeToPage {
  if (!isEnvelope(value)) {
    return false;
  }
  switch (value.t) {
    case "ready":
    case "unavailable":
      return true;
    case "call":
      return (
        isLine(value.id, MAX_ID_LENGTH) &&
        typeof value.method === "string" &&
        (BRIDGE_METHODS as readonly string[]).includes(value.method) &&
        isRecord(value.params)
      );
    case "navigate":
      return isBridgePath(value.path);
    case "resize":
      return typeof value.height === "number" && Number.isFinite(value.height) && value.height >= 0;
    case "title":
      return (
        typeof value.text === "string" &&
        value.text.length <= MAX_BRIDGE_TITLE_LENGTH &&
        !/[\r\n]/.test(value.text)
      );
    case "download":
      return isLine(value.id, MAX_ID_LENGTH);
    case "open":
      return isBridgeUrl(value.url);
    case "subscribe":
      return (
        Array.isArray(value.kinds) &&
        value.kinds.length <= BRIDGE_EVENT_KINDS.length &&
        value.kinds.every(
          (kind) =>
            typeof kind === "string" && (BRIDGE_EVENT_KINDS as readonly string[]).includes(kind),
        )
      );
    default:
      return false;
  }
}

/** The result of a command as the frame receives it, the same shape the command line prints from. */
export interface BridgeCommandResult {
  readonly kind: "command" | "query";
  readonly text: string;
  readonly data: unknown;
  readonly waiting: string | null;
}

/** What `records.list` and `records.get` carry in `params`, as the page sends them on. */
export interface BridgeRecordsListParams {
  readonly collection: string;
  readonly where?: Readonly<Record<string, unknown>>;
  readonly order?: string;
  readonly limit?: number;
  readonly after?: string;
  readonly q?: string;
  readonly project?: string;
}

export interface BridgeRecordsGetParams {
  readonly collection: string;
  readonly id: string;
  readonly version?: number;
}

export interface BridgeFilesPutParams {
  readonly bytes: ArrayBuffer;
  readonly name: string;
  readonly type: string;
}

/** What `files.get` answers: the bytes, transferred, with the file's name and type. */
/** A person's picture, as the page hands it to the frame (ADR-0063). */
export interface BridgePicture {
  readonly type: string;
  readonly bytes: ArrayBuffer;
}

export interface BridgeFile {
  readonly name: string;
  readonly type: string;
  readonly bytes: ArrayBuffer;
}
