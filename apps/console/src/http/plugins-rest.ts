// The plugins' routes (docs/specs/plugins.md, "REST"): what a member may know of the plugins,
// and what an administrator does with them. Every route runs as the board's do: parse, ask who
// is asking and whether they may, then do the work; what a member may not know of is not found.
import {
  EVENTS_PAGE_LIMIT,
  REST_ROUTES,
  type RestEvents,
  type RestPluginGrants,
  restPluginEnableInputSchema,
  restPluginGrantInputSchema,
  restPluginSecretInputSchema,
  restPluginSettingsPatchSchema,
} from "@skillcdn/console/api";
import {
  PLUGIN_KEY_PATTERN,
  PLUGIN_REFUSALS,
  PluginRefusal,
  SETTING_KEY_PATTERN,
} from "@skillcdn/console/plugin";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
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
