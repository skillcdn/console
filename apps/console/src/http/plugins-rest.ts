// The plugins' routes (docs/specs/plugins.md, "REST"): what a member may know of the plugins,
// and what an administrator does with them. Every route runs as the board's do: parse, ask who
// is asking and whether they may, then do the work; what a member may not know of is not found.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, resolve, sep } from "node:path";
import {
  EVENTS_PAGE_LIMIT,
  MAX_FILE_BYTES,
  pluginPath,
  REST_ROUTES,
  type RestEvents,
  type RestPluginEvents,
  type RestPluginGrants,
  type RestPluginInvocation,
  type RestSkillBrowse,
  type RestSkillFile,
  type RestSkillFind,
  type RestSkillLoad,
  type RestSkills,
  restFileInputSchema,
  restPluginCommandInputSchema,
  restPluginConsentPatchSchema,
  restPluginEnableInputSchema,
  restPluginGrantInputSchema,
  restPluginInvokeInputSchema,
  restPluginPurgeInputSchema,
  restPluginSecretInputSchema,
  restPluginSettingsPatchSchema,
} from "@skillcdn/console/api";
import {
  isQueryFile,
  MAX_PLUGIN_ENDPOINT_BODY_BYTES,
  PLUGIN_KEY_PATTERN,
  PLUGIN_LIST_LIMIT,
  PLUGIN_REFUSALS,
  PluginRefusal,
  type RecordQuery,
  SETTING_KEY_PATTERN,
} from "@skillcdn/console/plugin";
import type { WebRoot } from "@skillcdn/console/web";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { stream } from "hono/streaming";
import * as z from "zod";
import { configuresPlugins } from "../auth/policy.js";
import { PluginStoreError } from "../db/queries/plugins.js";
import { ProjectError } from "../db/queries/projects.js";
import type { Logger } from "../logger.js";
import { frameFile } from "../plugins/frame-holds.js";
import type { Caller, Invocation, Plugins } from "../plugins/registry.js";
import { createPluginSkills, pluginSkillsAddress } from "../plugins/skills.js";
import type { Clock } from "../ports/clock.js";
import { errorBody } from "./app.js";
import { type Access, administratorRequired, foreignOrigin, signInRequired } from "./auth.js";
import type { PictureCache } from "./pictures.js";
import type { AppEnv } from "./request-context.js";
import { restEvent } from "./rest-shapes.js";

export interface PluginsRestDependencies {
  readonly plugins: Plugins;
  readonly access: Access;
  readonly clock: Clock;
  readonly logger: Logger;
  /** The pictures from elsewhere, fetched by the console and kept a while (ADR-0048). */
  readonly pictures: PictureCache;
  /** The origin of the console's own pages (`PUBLIC_URL`), which may embed the plugins' frames; nothing where nobody signs in. */
  readonly ownOrigin: string | undefined;
  /** The build of the default UI, whose faces the frames read; nothing where the server is API only. */
  readonly web?: WebRoot | undefined;
}

/** A file of the build's faces, as a frame may read one: a name alone, of a font. */
const FONT_FILE_PATTERN = /^[A-Za-z0-9._-]+\.(?:woff2|woff|ttf|otf)$/;

const MAX_BODY_BYTES = 256 * 1024;
/** Where the console's own stylesheet is served for the plugins' frames (ADR-0054). */
const PLUGIN_RUNTIME = "/api/v1/plugin-runtime";
/** The package's stylesheet, as this app resolves it. */
const CONSOLE_STYLESHEET = createRequire(import.meta.url).resolve("@skillcdn/console/console.css");
/**
 * What a frame is served when there is nothing to show in it: a plugin that is off, a page it has
 * not. No words, which are the console's page's to say in the person's language: the document
 * tells the page and stays blank, so that a frame never shows an answer meant for a program.
 */
const FRAME_UNAVAILABLE_SCRIPT = `parent.postMessage({v:1,t:"unavailable"},"*")`;
const FRAME_UNAVAILABLE_DOCUMENT = `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body><script>${FRAME_UNAVAILABLE_SCRIPT}</script></body></html>\n`;
const FRAME_UNAVAILABLE_HASH = `sha256-${createHash("sha256").update(FRAME_UNAVAILABLE_SCRIPT).digest("base64")}`;

/** A person's own console, served on this machine by the command (ADR-0014): it may embed a frame too. */
const LOOPBACK_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;
/** What a bundle's files are served as, by extension; anything else as bytes. */
const BUNDLE_TYPES: Readonly<Record<string, string>> = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};
/** A value as an HTML attribute carries it. */
const attribute = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLUGIN = `${REST_ROUTES.plugins}/:key`;

const eventsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(EVENTS_PAGE_LIMIT).default(EVENTS_PAGE_LIMIT),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
/** What a read of a collection is narrowed by: conditions as JSON, an order, a page, words, a project. */
const recordsQuery = z.object({
  where: z.string().max(10_000).optional(),
  order: z
    .string()
    .regex(/^-?[A-Za-z_][A-Za-z0-9_]{0,63}$/, "is a field, with - before it for descending")
    .optional(),
  limit: z.coerce.number().int().min(1).max(PLUGIN_LIST_LIMIT).optional(),
  after: z.string().max(4000).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  project: z.string().max(40).optional(),
  archived: z.enum(["true", "false"]).optional(),
});
const versionQuery = z.object({
  version: z.coerce.number().int().min(1).optional(),
});
/** A page of a plugin's own events: after which number, how many at most. */
const pluginEventsQuery = z.object({
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(PLUGIN_LIST_LIMIT).default(100),
});
/** What a query is asked with: its arguments as JSON, and the project the call is on. */
const queryQuery = z.object({
  args: z.string().max(100_000).optional(),
  project: z.string().max(40).optional(),
});
/** The five reads of a plugin's skills, asked as a project's are (http/rest.ts). */
const skillQuery = z.object({
  path: z.string().min(1).max(500),
  cursor: z.string().max(4000).optional(),
});
const fileQuery = z.object({
  path: z.string().min(1).max(500),
  offset: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(100_000).optional(),
});
const browseQuery = z.object({
  path: z.string().max(500).optional(),
  cursor: z.string().max(4000).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
const findQuery = z.object({
  query: z.string().min(1).max(500),
  path: z.string().max(500).optional(),
  cursor: z.string().max(4000).optional(),
  limit: z.coerce.number().int().min(1).max(25).optional(),
});

/** A file's name as a header carries it: printable ASCII, no quotes. */
const plainName = (name: string): string =>
  name.replaceAll(/[^\x20-\x7e]/g, "_").replaceAll(/["\\]/g, "_");

/** Who presents a request, as the registry takes it. */
const callerOf = (caller: {
  readonly person: Caller["person"];
  readonly token: { readonly id: string; readonly name: string } | undefined;
}): Caller => ({
  person: caller.person,
  token: caller.token === undefined ? undefined : { id: caller.token.id, name: caller.token.name },
});

/**
 * What a command or a query answered, as the route carries it: a query's file as its name, its
 * type, its size and its bytes in base64, since the answer is JSON.
 */
function invocationBody(result: Invocation): RestPluginInvocation {
  if (isQueryFile(result.data)) {
    const { file } = result.data;
    return {
      ...result,
      data: {
        file: {
          name: file.name,
          type: file.type,
          bytes: file.bytes.byteLength,
          base64: Buffer.from(file.bytes).toString("base64"),
        },
      },
    };
  }
  return { ...result, data: result.data ?? null };
}
/** Media types a browser may show in place; a file of any other kind is handed over as bytes. */
const INLINE_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
]);

export function registerPluginsRest(
  app: Hono<AppEnv>,
  dependencies: PluginsRestDependencies,
): void {
  const { plugins, access, clock, logger, pictures, ownOrigin, web } = dependencies;

  /**
   * The faces of the console's own build, for the frames: the `@font-face` rules of the
   * stylesheets its page links, with their files named where this module serves them. Read once,
   * since the build does not change while the server runs; nothing without a build.
   */
  let faces: Promise<string> | undefined;
  const readFaces = async (): Promise<string> => {
    if (web === undefined) {
      return "";
    }
    const page = await web.respond(new Request("http://console/"));
    const html = page === undefined ? "" : await page.text();
    const found: string[] = [];
    for (const [tag] of html.matchAll(/<link\b[^>]*>/g)) {
      if (!/\brel="stylesheet"/.test(tag)) {
        continue;
      }
      const href = /\bhref="(\/[^"]+\.css)"/.exec(tag)?.[1];
      const sheet =
        href === undefined ? undefined : await web.respond(new Request(`http://console${href}`));
      const css = sheet === undefined ? "" : await sheet.text();
      for (const rule of css.match(/@font-face\s*\{[^}]*\}/g) ?? []) {
        found.push(rule.replaceAll(/url\((["']?)\/assets\//g, "url($1assets/"));
      }
    }
    return found.join("\n");
  };
  const facesOf = (): Promise<string> => {
    faces ??= readFaces().catch((error: unknown) => {
      faces = undefined;
      logger.warn(
        { err: error },
        "the faces of the console's build could not be read for the plugins' frames",
      );
      return "";
    });
    return faces;
  };

  const asking = async (c: Context<AppEnv>) => (await access.caller(c)) ?? signInRequired(c);
  /** An administrator, from the console's own pages or with a token, or the refusal. */
  const administering = async (c: Context<AppEnv>) => {
    if (!access.presentsToken(c) && !access.fromOwnPages(c)) {
      return foreignOrigin(c);
    }
    const caller = await asking(c);
    if (caller instanceof Response) {
      return caller;
    }
    if (!configuresPlugins(caller.person)) {
      return administratorRequired(c);
    }
    return {
      person: caller.person,
      actor:
        caller.token === undefined
          ? { id: caller.person.id }
          : { id: caller.person.id, agent: caller.token.name },
    };
  };
  /** An administrator reading, with a session from anywhere or a token, or the refusal. */
  const readingAdministrator = async (c: Context<AppEnv>) => {
    const caller = await asking(c);
    if (caller instanceof Response) {
      return caller;
    }
    return configuresPlugins(caller.person) ? caller : administratorRequired(c);
  };
  const invalid = (c: Context<AppEnv>, message: string): Response =>
    c.json(errorBody("request.invalid", message), 400);
  const notFound = (c: Context<AppEnv>): Response =>
    c.json(errorBody("plugin.not_found", "No plugin has this key."), 404);
  /** The plugin's key in the path, or nothing for text that is not one. */
  const keyOf = (c: Context<AppEnv>): string | undefined => {
    const key = c.req.param("key") ?? "";
    return PLUGIN_KEY_PATTERN.test(key) ? key : undefined;
  };
  const tooLarge = bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => c.json(errorBody("request.too_large", "The request body is too large."), 413),
  });
  const bodyOf = async <T>(
    c: Context<AppEnv>,
    schema: {
      safeParse: (data: unknown) => {
        success: boolean;
        data?: T;
        error?: { issues: readonly { path?: PropertyKey[]; message: string }[] };
      };
    },
  ): Promise<T | Response> => {
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return invalid(c, "The request body is not readable JSON.");
    }
    const parsed = schema.safeParse(json);
    if (parsed.success && parsed.data !== undefined) {
      return parsed.data;
    }
    const issue = parsed.error?.issues[0];
    const path = (issue?.path ?? []).map(String).join(".");
    return invalid(
      c,
      issue === undefined
        ? "The request is not readable."
        : path.length === 0
          ? issue.message
          : `${path}: ${issue.message}`,
    );
  };
  /** A refusal of the plugins, in the console's form, with the status its code has. */
  const failure = (c: Context<AppEnv>, error: unknown): Response => {
    if (error instanceof PluginRefusal) {
      return c.json(errorBody(error.code, error.message), error.status as 400);
    }
    if (error instanceof PluginStoreError) {
      const status = (PLUGIN_REFUSALS as Readonly<Record<string, number>>)[error.code] ?? 400;
      return c.json(errorBody(error.code, error.message), status as 400);
    }
    if (error instanceof ProjectError) {
      return c.json(
        errorBody(error.code, error.message),
        error.code === "project.not_found" ? 404 : 409,
      );
    }
    throw error;
  };

  app.get(REST_ROUTES.plugins, async (c) => {
    const caller = await asking(c);
    if (caller instanceof Response) {
      return caller;
    }
    return c.json(await plugins.list(caller.person));
  });

  app.get(PLUGIN, async (c) => {
    const caller = await asking(c);
    if (caller instanceof Response) {
      return caller;
    }
    const key = keyOf(c);
    const detail = key === undefined ? undefined : await plugins.get(key, caller.person);
    return detail === undefined ? notFound(c) : c.json(detail);
  });

  app.post(`${PLUGIN}/enable`, tooLarge, async (c) => {
    const by = await administering(c);
    if (by instanceof Response) {
      return by;
    }
    const key = keyOf(c);
    if (key === undefined) {
      return notFound(c);
    }
    const input = await bodyOf(c, restPluginEnableInputSchema);
    if (input instanceof Response) {
      return input;
    }
    try {
      const detail = await plugins.enable(key, input, by);
      logger.info(
        { person: by.person.id, plugin: key, requestId: c.get("requestId") },
        "plugin enabled",
      );
      return c.json(detail);
    } catch (error) {
      return failure(c, error);
    }
  });

  app.post(`${PLUGIN}/disable`, async (c) => {
    const by = await administering(c);
    if (by instanceof Response) {
      return by;
    }
    const key = keyOf(c);
    if (key === undefined) {
      return notFound(c);
    }
    try {
      return c.json(await plugins.disable(key, by));
    } catch (error) {
      return failure(c, error);
    }
  });

  app.patch(`${PLUGIN}/settings`, tooLarge, async (c) => {
    const by = await administering(c);
    if (by instanceof Response) {
      return by;
    }
    const key = keyOf(c);
    if (key === undefined) {
      return notFound(c);
    }
    const patch = await bodyOf(c, restPluginSettingsPatchSchema);
    if (patch instanceof Response) {
      return patch;
    }
    try {
      return c.json(await plugins.updateSettings(key, patch.values, by));
    } catch (error) {
      return failure(c, error);
    }
  });

  /** The secret's name in the path, as a setting is keyed. */
  const secretNameOf = (c: Context<AppEnv>): string | undefined => {
    const name = c.req.param("name") ?? "";
    return SETTING_KEY_PATTERN.test(name) ? name : undefined;
  };

  app.patch(`${PLUGIN}/consent`, tooLarge, async (c) => {
    const by = await administering(c);
    if (by instanceof Response) {
      return by;
    }
    const key = keyOf(c);
    if (key === undefined) {
      return notFound(c);
    }
    const patch = await bodyOf(c, restPluginConsentPatchSchema);
    if (patch instanceof Response) {
      return patch;
    }
    try {
      return c.json(await plugins.updateConsent(key, patch.consent, by));
    } catch (error) {
      return failure(c, error);
    }
  });

  app.put(`${PLUGIN}/secrets/:name`, tooLarge, async (c) => {
    const by = await administering(c);
    if (by instanceof Response) {
      return by;
    }
    const key = keyOf(c);
    const name = secretNameOf(c);
    if (key === undefined || name === undefined) {
      return notFound(c);
    }
    const input = await bodyOf(c, restPluginSecretInputSchema);
    if (input instanceof Response) {
      return input;
    }
    try {
      await plugins.setSecret(key, name, input.value, by);
      return c.body(null, 204);
    } catch (error) {
      return failure(c, error);
    }
  });

  app.delete(`${PLUGIN}/secrets/:name`, async (c) => {
    const by = await administering(c);
    if (by instanceof Response) {
      return by;
    }
    const key = keyOf(c);
    const name = secretNameOf(c);
    if (key === undefined || name === undefined) {
      return notFound(c);
    }
    try {
      await plugins.removeSecret(key, name, by);
      return c.body(null, 204);
    } catch (error) {
      return failure(c, error);
    }
  });

  app.get(`${PLUGIN}/grants`, async (c) => {
    const by = await readingAdministrator(c);
    if (by instanceof Response) {
      return by;
    }
    const key = keyOf(c);
    if (key === undefined) {
      return notFound(c);
    }
    try {
      const body: RestPluginGrants = { items: await plugins.grants(key) };
      return c.json(body);
    } catch (error) {
      return failure(c, error);
    }
  });

  app.post(`${PLUGIN}/grants`, tooLarge, async (c) => {
    const by = await administering(c);
    if (by instanceof Response) {
      return by;
    }
    const key = keyOf(c);
    if (key === undefined) {
      return notFound(c);
    }
    const input = await bodyOf(c, restPluginGrantInputSchema);
    if (input instanceof Response) {
      return input;
    }
    try {
      return c.json(await plugins.grant(key, input, by), 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  app.delete(`${PLUGIN}/grants/:id`, async (c) => {
    const by = await administering(c);
    if (by instanceof Response) {
      return by;
    }
    const key = keyOf(c);
    const id = c.req.param("id") ?? "";
    if (key === undefined || !UUID.test(id)) {
      return notFound(c);
    }
    try {
      return c.json(await plugins.revoke(key, id, by));
    } catch (error) {
      return failure(c, error);
    }
  });

  /** A collection's name in the path, as a key, or nothing. */
  const collectionOf = (c: Context<AppEnv>): string | undefined => {
    const name = c.req.param("collection") ?? "";
    return PLUGIN_KEY_PATTERN.test(name) ? name : undefined;
  };

  app.get(`${PLUGIN}/records/:collection`, async (c) => {
    const caller = await asking(c);
    if (caller instanceof Response) {
      return caller;
    }
    const key = keyOf(c);
    const collection = collectionOf(c);
    if (key === undefined || collection === undefined) {
      return notFound(c);
    }
    const query = recordsQuery.safeParse(c.req.query());
    if (!query.success) {
      return invalid(c, query.error.issues[0]?.message ?? "The query is not readable.");
    }
    let where: RecordQuery["where"];
    if (query.data.where !== undefined) {
      try {
        const parsed: unknown = JSON.parse(query.data.where);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          return invalid(c, "where: is a JSON object of conditions.");
        }
        where = parsed as RecordQuery["where"];
      } catch {
        return invalid(c, "where: is not JSON.");
      }
    }
    try {
      const order =
        query.data.order === undefined
          ? undefined
          : query.data.order.startsWith("-")
            ? { field: query.data.order.slice(1), descending: true }
            : { field: query.data.order };
      const page = await plugins.readRecords(
        key,
        collection,
        {
          where,
          order,
          limit: query.data.limit,
          after: query.data.after,
          project: query.data.project,
          archived: query.data.archived === "true",
          q: query.data.q,
        },
        caller.person,
      );
      return c.json(page);
    } catch (error) {
      return failure(c, error);
    }
  });

  app.get(`${PLUGIN}/records/:collection/:id`, async (c) => {
    const caller = await asking(c);
    if (caller instanceof Response) {
      return caller;
    }
    const key = keyOf(c);
    const collection = collectionOf(c);
    const id = c.req.param("id") ?? "";
    if (key === undefined || collection === undefined || !UUID.test(id)) {
      return notFound(c);
    }
    const query = versionQuery.safeParse(c.req.query());
    if (!query.success) {
      return invalid(c, query.error.issues[0]?.message ?? "The query is not readable.");
    }
    try {
      const record = await plugins.readRecord(
        key,
        collection,
        id,
        query.data.version,
        caller.person,
      );
      return record === undefined
        ? c.json(errorBody("plugin.not_found", "The record was not found."), 404)
        : c.json(record);
    } catch (error) {
      return failure(c, error);
    }
  });

  app.get(`${PLUGIN}/records/:collection/:id/versions`, async (c) => {
    const caller = await asking(c);
    if (caller instanceof Response) {
      return caller;
    }
    const key = keyOf(c);
    const collection = collectionOf(c);
    const id = c.req.param("id") ?? "";
    if (key === undefined || collection === undefined || !UUID.test(id)) {
      return notFound(c);
    }
    try {
      return c.json({ items: await plugins.readVersions(key, collection, id, caller.person) });
    } catch (error) {
      return failure(c, error);
    }
  });

  const fileTooLarge = bodyLimit({
    maxSize: MAX_FILE_BYTES + 64 * 1024,
    onError: (c) =>
      c.json(errorBody("request.too_large", `The file is over ${MAX_FILE_BYTES} bytes.`), 413),
  });

  app.post(`${PLUGIN}/files`, fileTooLarge, async (c) => {
    if (!access.presentsToken(c) && !access.fromOwnPages(c)) {
      return foreignOrigin(c);
    }
    const caller = await asking(c);
    if (caller instanceof Response) {
      return caller;
    }
    const key = keyOf(c);
    if (key === undefined) {
      return notFound(c);
    }
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return invalid(c, "The request body is not a form with a file in it.");
    }
    const part = form.get("file");
    if (!(part instanceof File)) {
      return invalid(c, "file: the form needs a part called file.");
    }
    const type = part.type.split(";")[0]?.trim() ?? "";
    const parsed = restFileInputSchema.safeParse({
      name: part.name,
      ...(type.length === 0 ? {} : { contentType: type }),
    });
    if (!parsed.success || parsed.data === undefined) {
      return invalid(c, parsed.error?.issues[0]?.message ?? "file: the file is not readable.");
    }
    if (part.size === 0 || part.size > MAX_FILE_BYTES) {
      return invalid(c, `file: the file is empty or over ${MAX_FILE_BYTES} bytes.`);
    }
    try {
      const handle = await plugins.upload(
        key,
        caller.person,
        new Uint8Array(await part.arrayBuffer()),
        parsed.data.name,
        parsed.data.contentType ?? "application/octet-stream",
      );
      return c.json(handle, 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  // A person's picture, for a frame, which has no way out of its own (ADR-0063). It names the
  // person and never an address: an address would be a way out, through the console.
  app.get(`${PLUGIN}/people/:id/picture`, async (c) => {
    const caller = await asking(c);
    if (caller instanceof Response) {
      return caller;
    }
    const key = keyOf(c);
    const id = c.req.param("id") ?? "";
    if (key === undefined || !UUID.test(id)) {
      return notFound(c);
    }
    try {
      const src = await plugins.pictureOf(key, id, caller.person);
      if (src === undefined) {
        return c.json(errorBody("plugin.not_found", "The person has no picture."), 404);
      }
      const answer = await pictures.get(src);
      if (answer.kind === "refused") {
        return c.json(errorBody("picture.unavailable", "The picture could not be fetched."), 502);
      }
      c.header("content-type", answer.picture.contentType);
      c.header("cache-control", "private, max-age=86400");
      c.header("x-content-type-options", "nosniff");
      c.header("content-security-policy", "default-src 'none'; sandbox");
      c.header("cross-origin-resource-policy", "same-origin");
      // A copy of its own: what the cache holds may be a view of a larger buffer.
      return c.body(new Uint8Array(answer.picture.bytes).buffer);
    } catch (error) {
      return failure(c, error);
    }
  });

  app.get(`${PLUGIN}/files/:id`, async (c) => {
    const caller = await asking(c);
    if (caller instanceof Response) {
      return caller;
    }
    const key = keyOf(c);
    const id = c.req.param("id") ?? "";
    if (key === undefined || !UUID.test(id)) {
      return notFound(c);
    }
    try {
      const file = await plugins.fileFor(key, id, caller.person);
      if (file === undefined) {
        return c.json(errorBody("plugin.not_found", "The file was not found."), 404);
      }
      const inline = INLINE_TYPES.has(file.contentType);
      const type = inline ? file.contentType : "application/octet-stream";
      c.header(
        "content-type",
        type.startsWith("text/") || type === "application/json" ? `${type}; charset=utf-8` : type,
      );
      c.header("content-length", String(file.bytes.byteLength));
      const plain = file.name.replaceAll(/[^\x20-\x7e]/g, "_").replaceAll(/["\\]/g, "_");
      c.header("content-disposition", `${inline ? "inline" : "attachment"}; filename="${plain}"`);
      c.header("x-content-type-options", "nosniff");
      c.header("content-security-policy", "default-src 'none'; sandbox");
      c.header("cross-origin-resource-policy", "same-origin");
      // A copy of its own: what the store hands over may be a view of a larger buffer.
      return c.body(new Uint8Array(file.bytes).buffer);
    } catch (error) {
      return failure(c, error);
    }
  });

  app.get(`${PLUGIN}/export`, async (c) => {
    const by = await readingAdministrator(c);
    if (by instanceof Response) {
      return by;
    }
    const key = keyOf(c);
    if (key === undefined) {
      return notFound(c);
    }
    try {
      // The first line is read before the stream starts, so that a refusal is an answer, not a cut.
      const lines = plugins.exportLines(key);
      const first = await lines.next();
      c.header("content-type", "application/x-ndjson; charset=utf-8");
      c.header("content-disposition", `attachment; filename="${key}.jsonl"`);
      return stream(c, async (body) => {
        if (!first.done) {
          await body.write(first.value);
        }
        for await (const line of lines) {
          await body.write(line);
        }
      });
    } catch (error) {
      return failure(c, error);
    }
  });

  app.post(`${PLUGIN}/purge`, tooLarge, async (c) => {
    const by = await administering(c);
    if (by instanceof Response) {
      return by;
    }
    const key = keyOf(c);
    if (key === undefined) {
      return notFound(c);
    }
    const input = await bodyOf(c, restPluginPurgeInputSchema);
    if (input instanceof Response) {
      return input;
    }
    try {
      await plugins.purge(key, input.confirm, by);
      logger.info(
        { person: by.person.id, plugin: key, requestId: c.get("requestId") },
        "plugin purged",
      );
      return c.body(null, 204);
    } catch (error) {
      return failure(c, error);
    }
  });

  app.get(`${PLUGIN}/plugin-events`, async (c) => {
    const caller = await asking(c);
    if (caller instanceof Response) {
      return caller;
    }
    const key = keyOf(c);
    const detail = key === undefined ? undefined : await plugins.get(key, caller.person);
    if (key === undefined || detail === undefined) {
      return notFound(c);
    }
    // The plugin's own events are its role holders': what its frames show them.
    if (
      !configuresPlugins(caller.person) &&
      detail.declaredRoles.length > 0 &&
      detail.roles.length === 0
    ) {
      return c.json(
        errorBody("plugin.forbidden", "The plugin's events are read by those in a role of it."),
        403,
      );
    }
    const query = pluginEventsQuery.safeParse(c.req.query());
    if (!query.success) {
      return invalid(c, query.error.issues[0]?.message ?? "The query is not readable.");
    }
    try {
      const body: RestPluginEvents = await plugins.pluginEvents(key, query.data);
      return c.json(body);
    } catch (error) {
      return failure(c, error);
    }
  });

  app.get(`${PLUGIN}/events`, async (c) => {
    const caller = await asking(c);
    if (caller instanceof Response) {
      return caller;
    }
    const key = keyOf(c);
    if (key === undefined || (await plugins.get(key, caller.person)) === undefined) {
      return notFound(c);
    }
    const query = eventsQuery.safeParse(c.req.query());
    if (!query.success) {
      return invalid(c, query.error.issues[0]?.message ?? "The query is not readable.");
    }
    try {
      const page = await plugins.events(key, query.data);
      const body: RestEvents = { items: page.items.map(restEvent), more: page.more };
      return c.json(body);
    } catch (error) {
      return failure(c, error);
    }
  });

  // ---- A command or a query, run as the person (docs/specs/plugins.md, "REST").

  /** Who runs a command, with the project the call is on and the run it is for, or the refusal. */
  const invoking = async (
    c: Context<AppEnv>,
    key: string,
    options: { readonly project?: string | undefined; readonly run?: string | undefined },
  ) => {
    if (!access.presentsToken(c) && !access.fromOwnPages(c)) {
      return foreignOrigin(c);
    }
    const caller = await asking(c);
    if (caller instanceof Response) {
      return caller;
    }
    return plugins.invokerOf(key, callerOf(caller), options);
  };

  /** The name of a command, a query or an endpoint in the path, or nothing for text that is not one. */
  const nameOf = (c: Context<AppEnv>): string | undefined => {
    const name = c.req.param("name") ?? "";
    return PLUGIN_KEY_PATTERN.test(name) ? name : undefined;
  };

  app.post(`${PLUGIN}/invoke`, tooLarge, async (c) => {
    const key = keyOf(c);
    if (key === undefined) {
      return notFound(c);
    }
    const input = await bodyOf(c, restPluginInvokeInputSchema);
    if (input instanceof Response) {
      return input;
    }
    try {
      const by = await invoking(c, key, { project: input.project, run: input.run });
      if (by instanceof Response) {
        return by;
      }
      const result = await plugins.invokeArgv(key, input.argv, input.files ?? [], by);
      return c.json(invocationBody(result));
    } catch (error) {
      return failure(c, error);
    }
  });

  app.post(`${PLUGIN}/commands/:name`, tooLarge, async (c) => {
    const key = keyOf(c);
    const name = nameOf(c);
    if (key === undefined || name === undefined) {
      return notFound(c);
    }
    const input = await bodyOf(c, restPluginCommandInputSchema);
    if (input instanceof Response) {
      return input;
    }
    try {
      const by = await invoking(c, key, { project: input.project, run: input.run });
      if (by instanceof Response) {
        return by;
      }
      const result = await plugins.invoke(key, "command", name, input.args, by);
      return c.json(invocationBody(result));
    } catch (error) {
      return failure(c, error);
    }
  });

  app.get(`${PLUGIN}/queries/:name`, async (c) => {
    const caller = await asking(c);
    if (caller instanceof Response) {
      return caller;
    }
    const key = keyOf(c);
    const name = nameOf(c);
    if (key === undefined || name === undefined) {
      return notFound(c);
    }
    const query = queryQuery.safeParse(c.req.query());
    if (!query.success) {
      return invalid(c, query.error.issues[0]?.message ?? "The query is not readable.");
    }
    let args: Record<string, unknown> = {};
    if (query.data.args !== undefined) {
      try {
        const parsed: unknown = JSON.parse(query.data.args);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          return invalid(c, "args: is a JSON object of the arguments by name.");
        }
        args = parsed as Record<string, unknown>;
      } catch {
        return invalid(c, "args: is not JSON.");
      }
    }
    try {
      const by = await plugins.invokerOf(key, callerOf(caller), { project: query.data.project });
      const result = await plugins.invoke(key, "query", name, args, by);
      if (isQueryFile(result.data)) {
        const { file } = result.data;
        c.header(
          "content-type",
          file.type.startsWith("text/") ? `${file.type}; charset=utf-8` : file.type,
        );
        c.header("content-length", String(file.bytes.byteLength));
        c.header("content-disposition", `attachment; filename="${plainName(file.name)}"`);
        c.header("x-content-type-options", "nosniff");
        c.header("content-security-policy", "default-src 'none'; sandbox");
        c.header("cross-origin-resource-policy", "same-origin");
        return c.body(new Uint8Array(file.bytes).buffer);
      }
      return c.json(result.data ?? null);
    } catch (error) {
      return failure(c, error);
    }
  });

  // ---- An endpoint of the plugin: a person's, or a webhook's (docs/specs/plugins.md, "The server module").

  const endpointBodyTooLarge = bodyLimit({
    maxSize: MAX_PLUGIN_ENDPOINT_BODY_BYTES,
    onError: (c) =>
      c.json(
        errorBody(
          "request.too_large",
          `The request body is over ${MAX_PLUGIN_ENDPOINT_BODY_BYTES} bytes.`,
        ),
        413,
      ),
  });

  const endpoint = async (c: Context<AppEnv>) => {
    const key = keyOf(c);
    const name = nameOf(c);
    if (key === undefined || name === undefined) {
      return notFound(c);
    }
    // Who: the person a token or a session names; a session's request from elsewhere than the
    // console's own pages counts for nobody, as every change does, except for a read.
    const method = c.req.method.toUpperCase();
    const caller = await access.caller(c);
    const nobody =
      caller === undefined ||
      (caller.token === undefined &&
        method !== "GET" &&
        method !== "HEAD" &&
        !access.fromOwnPages(c));
    const prefix = `${REST_ROUTES.plugins}/${key}/x/${name}`;
    const path = c.req.path.startsWith(prefix) ? c.req.path.slice(prefix.length) : "";
    const url = new URL(c.req.url);
    const query: Record<string, string> = {};
    for (const [param, value] of url.searchParams) {
      if (!(param in query)) {
        query[param] = value;
      }
    }
    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((value, header) => {
      headers[header.toLowerCase()] = value;
    });
    try {
      const by =
        nobody || caller === undefined ? undefined : await plugins.invokerOf(key, callerOf(caller));
      const body = method === "GET" || method === "HEAD" ? "" : await c.req.text();
      const answer = await plugins.callEndpoint(
        key,
        name,
        { method, path, query, headers, body },
        by,
      );
      const text =
        answer.body === undefined
          ? undefined
          : typeof answer.body === "string"
            ? answer.body
            : JSON.stringify(answer.body);
      const type =
        answer.headers?.["content-type"] ??
        (typeof answer.body === "string" ? "text/plain; charset=utf-8" : "application/json");
      // The answer is built whole: the headers the plugin set among those allowed, and the
      // console's own, so that nothing the plugin wrote is rendered in the console's origin.
      const answered = new Headers();
      for (const [header, value] of Object.entries(answer.headers ?? {})) {
        if (value !== undefined) {
          answered.set(header, value);
        }
      }
      if (text !== undefined) {
        answered.set("content-type", type);
      }
      if (!answered.has("cache-control")) {
        answered.set("cache-control", "no-store");
      }
      answered.set("x-content-type-options", "nosniff");
      answered.set("content-security-policy", "default-src 'none'; sandbox");
      answered.set("cross-origin-resource-policy", "same-origin");
      answered.set("x-request-id", c.get("requestId"));
      return new Response(text ?? null, { status: answer.status, headers: answered });
    } catch (error) {
      return failure(c, error);
    }
  };
  app.all(`${PLUGIN}/x/:name`, endpointBodyTooLarge, endpoint);
  app.all(`${PLUGIN}/x/:name/*`, endpointBodyTooLarge, endpoint);

  // ---- The plugin's skills, a pack of its own read from its package (docs/specs/plugins.md, "REST").

  const pluginSkills = createPluginSkills({ plugins, clock, logger });
  /** Nothing to read: a plugin that ships no skills answers as a project without an address does. */
  const noPack = {
    address: null,
    source: null,
    page: null,
    status: "none" as const,
    refusal: null,
  };
  /** The plugin whose skills are asked for, as the caller may know of it, or the refusal; `null` for one without skills. */
  const skillsOf = async (c: Context<AppEnv>): Promise<string | null | Response> => {
    const caller = await asking(c);
    if (caller instanceof Response) {
      return caller;
    }
    const key = keyOf(c);
    const detail = key === undefined ? undefined : await plugins.get(key, caller.person);
    if (key === undefined || detail === undefined) {
      return notFound(c);
    }
    return detail.skills === null ? null : key;
  };

  app.get(`${PLUGIN}/skills`, async (c) => {
    const key = await skillsOf(c);
    if (key instanceof Response) {
      return key;
    }
    const body: RestSkills =
      key === null
        ? { ...noPack, items: [], mount: null }
        : await pluginSkills.read(pluginSkillsAddress(key));
    return c.json(body);
  });

  app.get(`${PLUGIN}/skills/one`, async (c) => {
    const key = await skillsOf(c);
    if (key instanceof Response) {
      return key;
    }
    const query = skillQuery.safeParse({
      path: c.req.query("path"),
      cursor: c.req.query("cursor"),
    });
    if (!query.success) {
      return invalid(c, `query: ${query.error.message}`);
    }
    const body: RestSkillLoad =
      key === null
        ? { ...noPack, read: null }
        : await pluginSkills.load(pluginSkillsAddress(key), query.data.path, query.data.cursor);
    return c.json(body);
  });

  app.get(`${PLUGIN}/skills/file`, async (c) => {
    const key = await skillsOf(c);
    if (key instanceof Response) {
      return key;
    }
    const query = fileQuery.safeParse({
      path: c.req.query("path"),
      offset: c.req.query("offset"),
      limit: c.req.query("limit"),
    });
    if (!query.success) {
      return invalid(c, `query: ${query.error.message}`);
    }
    const body: RestSkillFile =
      key === null
        ? { ...noPack, read: null }
        : await pluginSkills.file(pluginSkillsAddress(key), query.data);
    return c.json(body);
  });

  app.get(`${PLUGIN}/skills/browse`, async (c) => {
    const key = await skillsOf(c);
    if (key instanceof Response) {
      return key;
    }
    const query = browseQuery.safeParse({
      path: c.req.query("path"),
      cursor: c.req.query("cursor"),
      limit: c.req.query("limit"),
    });
    if (!query.success) {
      return invalid(c, `query: ${query.error.message}`);
    }
    const body: RestSkillBrowse =
      key === null
        ? { ...noPack, read: null }
        : await pluginSkills.browse(pluginSkillsAddress(key), query.data);
    return c.json(body);
  });

  app.get(`${PLUGIN}/skills/find`, async (c) => {
    const key = await skillsOf(c);
    if (key instanceof Response) {
      return key;
    }
    const query = findQuery.safeParse({
      query: c.req.query("query"),
      path: c.req.query("path"),
      cursor: c.req.query("cursor"),
      limit: c.req.query("limit"),
    });
    if (!query.success) {
      return invalid(c, `query: ${query.error.message}`);
    }
    const body: RestSkillFind =
      key === null
        ? { ...noPack, read: null }
        : await pluginSkills.find(pluginSkillsAddress(key), query.data);
    return c.json(body);
  });

  // ---- The frame of a page or a widget, and the files of the bundle (ADR-0054, "The frame").

  /** The origin of the page that embeds a frame: the console's own, or a loopback where a person's own console is served (ADR-0014); nothing for any other. */
  const embedderOf = (c: Context<AppEnv>): string | undefined => {
    const referer = c.req.header("referer");
    if (referer === undefined || !URL.canParse(referer)) {
      return undefined;
    }
    const origin = new URL(referer).origin;
    return origin === ownOrigin || LOOPBACK_ORIGIN.test(origin) ? origin : undefined;
  };

  /** What every document of a frame is served with, under the policy it has. */
  const frameHeaders = (c: Context<AppEnv>, policy: readonly string[]): void => {
    c.header("content-security-policy", policy.join("; "));
    c.header("referrer-policy", "no-referrer");
    c.header("x-content-type-options", "nosniff");
    c.header("cache-control", "no-store");
  };

  app.get(`${PLUGIN}/frame`, async (c) => {
    const key = keyOf(c);
    const origin = embedderOf(c);
    const page = c.req.query("page");
    const widget = c.req.query("widget");
    const name = page ?? widget;
    if (
      key === undefined ||
      origin === undefined ||
      name === undefined ||
      (page !== undefined && widget !== undefined) ||
      !PLUGIN_KEY_PATTERN.test(name)
    ) {
      return notFound(c);
    }
    const web = await plugins.webOf(key);
    if (web === undefined || !(page === undefined ? web.widgets : web.pages).includes(name)) {
      frameHeaders(c, [
        "default-src 'none'",
        `script-src '${FRAME_UNAVAILABLE_HASH}'`,
        `frame-ancestors ${origin}`,
        "base-uri 'none'",
        "form-action 'none'",
        "sandbox allow-scripts",
      ]);
      return c.html(FRAME_UNAVAILABLE_DOCUMENT, 404);
    }
    const bundle = `${origin}${pluginPath(key, "web", web.version)}`;
    const runtime = `${origin}${PLUGIN_RUNTIME}`;
    const html = [
      "<!doctype html>",
      `<html lang="en" data-console="${attribute(origin)}" data-plugin="${attribute(key)}" data-${page === undefined ? "widget" : "page"}="${attribute(name)}">`,
      "<head>",
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      `<link rel="stylesheet" href="${attribute(`${runtime}/fonts.css`)}">`,
      `<link rel="stylesheet" href="${attribute(`${runtime}/console.css`)}">`,
      `<link rel="stylesheet" href="${attribute(`${bundle}/index.css`)}">`,
      "</head>",
      `<body><div id="root"></div><script type="module" src="${attribute(`${bundle}/index.js`)}"></script></body>`,
      "</html>",
      "",
    ].join("\n");
    const webPath = `${origin}${pluginPath(key, "web")}/`;
    frameHeaders(c, [
      "default-src 'none'",
      // This version's alone: what a browser kept of another began as that version held.
      `script-src ${bundle}/`,
      `style-src ${webPath} ${runtime}/`,
      `img-src ${webPath} data: blob:`,
      `font-src ${webPath} ${runtime}/`,
      "connect-src 'none'",
      `frame-ancestors ${origin}`,
      "base-uri 'none'",
      "form-action 'none'",
      // Forms fire their submit event (without allow-forms a browser drops the submission before
      // the event); form-action 'none' keeps a submission from going anywhere.
      "sandbox allow-scripts allow-forms",
    ]);
    return c.html(html);
  });

  app.get(`${PLUGIN}/web/:version/*`, async (c) => {
    const key = keyOf(c);
    const version = c.req.param("version") ?? "";
    const web = key === undefined ? undefined : await plugins.webOf(key);
    if (key === undefined || web === undefined || version !== web.version) {
      return notFound(c);
    }
    const prefix = `${pluginPath(key, "web", version)}/`;
    let relative: string;
    try {
      relative = decodeURIComponent(c.req.path.slice(prefix.length));
    } catch {
      return notFound(c);
    }
    const segments = relative.split("/");
    if (
      relative.length === 0 ||
      relative.includes("\0") ||
      segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
    ) {
      return notFound(c);
    }
    const root = resolve(web.dir);
    const file = resolve(root, ...segments);
    if (!file.startsWith(`${root}${sep}`)) {
      return notFound(c);
    }
    let bytes: Uint8Array;
    try {
      bytes = await readFile(file);
    } catch {
      return notFound(c);
    }
    const type = BUNDLE_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
    const served = frameFile(bytes, type, web.holds, { kept: web.kept });
    c.header("content-type", type);
    c.header("content-length", String(served.body.byteLength));
    c.header("cache-control", served.cacheControl);
    // The frame's origin is opaque, and a module script, as a font, is fetched with CORS: the
    // bundle, which holds no secret, is readable from any origin, or the browser runs none of it.
    c.header("cross-origin-resource-policy", "cross-origin");
    c.header("access-control-allow-origin", "*");
    c.header("x-content-type-options", "nosniff");
    // A frame may go to a file of its own bundle, where the frame's policy is gone, and an SVG is
    // a document that runs scripts: a file is loaded, under the frame's policy, and is never a page.
    c.header("content-security-policy", "default-src 'none'; sandbox");
    return c.body(new Uint8Array(served.body).buffer);
  });

  app.get(`${PLUGIN_RUNTIME}/console.css`, async (c) => {
    let bytes: Uint8Array;
    try {
      bytes = await readFile(CONSOLE_STYLESHEET);
    } catch (error) {
      logger.error(
        { err: error },
        "the console's stylesheet for the plugins' frames was not found",
      );
      return c.json(errorBody("plugin.unavailable", "The stylesheet is not available."), 503);
    }
    c.header("content-type", "text/css; charset=utf-8");
    c.header("content-length", String(bytes.byteLength));
    c.header("cache-control", "public, max-age=3600");
    c.header("cross-origin-resource-policy", "cross-origin");
    c.header("access-control-allow-origin", "*");
    c.header("x-content-type-options", "nosniff");
    return c.body(new Uint8Array(bytes).buffer);
  });

  // The console's faces, for the frames: the build's @font-face rules, and their files, fonts
  // alone, named by the build after their content and so kept for ever.
  app.get(`${PLUGIN_RUNTIME}/fonts.css`, async (c) => {
    const css = await facesOf();
    c.header("content-type", "text/css; charset=utf-8");
    c.header("cache-control", "public, max-age=3600");
    c.header("cross-origin-resource-policy", "cross-origin");
    c.header("access-control-allow-origin", "*");
    c.header("x-content-type-options", "nosniff");
    return c.body(css);
  });

  app.get(`${PLUGIN_RUNTIME}/assets/:file`, async (c) => {
    const file = c.req.param("file");
    if (web === undefined || !FONT_FILE_PATTERN.test(file)) {
      return c.notFound();
    }
    const answer = await web.respond(new Request(`http://console/assets/${file}`));
    // A build answers its page for a path it has no file at: a font is a font, or nothing.
    const type = answer?.headers.get("content-type") ?? "";
    if (answer === undefined || answer.status !== 200 || !type.startsWith("font/")) {
      return c.notFound();
    }
    const headers = new Headers({
      "content-type": type,
      "cache-control": "public, max-age=31536000, immutable",
      "cross-origin-resource-policy": "cross-origin",
      "access-control-allow-origin": "*",
      "x-content-type-options": "nosniff",
    });
    const etag = answer.headers.get("etag");
    if (etag !== null) {
      headers.set("etag", etag);
    }
    return new Response(answer.body, { status: 200, headers });
  });
}
