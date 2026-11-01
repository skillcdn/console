// The plugins' routes (docs/specs/plugins.md, "REST"): what a member may know of the plugins,
// and what an administrator does with them. Every route runs as the board's do: parse, ask who
// is asking and whether they may, then do the work; what a member may not know of is not found.
import {
  EVENTS_PAGE_LIMIT,
  MAX_FILE_BYTES,
  REST_ROUTES,
  type RestEvents,
  type RestPluginGrants,
  restFileInputSchema,
  restPluginEnableInputSchema,
  restPluginGrantInputSchema,
  restPluginPurgeInputSchema,
  restPluginSecretInputSchema,
  restPluginSettingsPatchSchema,
} from "@skillcdn/console/api";
import {
  PLUGIN_KEY_PATTERN,
  PLUGIN_LIST_LIMIT,
  PLUGIN_REFUSALS,
  PluginRefusal,
  type RecordQuery,
  SETTING_KEY_PATTERN,
} from "@skillcdn/console/plugin";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { stream } from "hono/streaming";
import * as z from "zod";
import { configuresPlugins } from "../auth/policy.js";
import { PluginStoreError } from "../db/queries/plugins.js";
import { ProjectError } from "../db/queries/projects.js";
import type { Logger } from "../logger.js";
import type { Plugins } from "../plugins/registry.js";
import { errorBody } from "./app.js";
import { type Access, administratorRequired, foreignOrigin, signInRequired } from "./auth.js";
import type { AppEnv } from "./request-context.js";
import { restEvent } from "./rest-shapes.js";

export interface PluginsRestDependencies {
  readonly plugins: Plugins;
  readonly access: Access;
  readonly logger: Logger;
}

const MAX_BODY_BYTES = 256 * 1024;
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
  const { plugins, access, logger } = dependencies;

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
}
