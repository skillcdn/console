import { isHandle, RESERVED_HANDLES } from "@skillcdn/console/api";
import type { Context } from "hono";
import { personVisibleTo, supervises } from "../auth/policy.js";
import type { Database } from "../db/client.js";
import { findAgent } from "../db/queries/agents.js";
import type { PersonRecord } from "../db/queries/people.js";
import { readWorkspaceSettings } from "../db/queries/workspaces.js";
import { errorBody } from "./app.js";
import { type Access, type AccessCaller, foreignOrigin, signInRequired } from "./auth.js";
import type { AppEnv } from "./request-context.js";

// Who may ask what of an agent account's runner, its signals and its transcript (ADR-0084,
// ADR-0085, ADR-0086), decided on every request and refused when it cannot be confirmed: the
// account's own runner, the account itself, a supervisor of it.

export interface AgentGuards {
  /**
   * The account's own runner asking, or the refusal: an agent account, on the session of its
   * command signed in as itself (ADR-0084), which is the runner's one credential. Neither a
   * browser nor a token the account made stands in for it.
   */
  running(c: Context<AppEnv>): Promise<AccessCaller | Response>;
  /** The account itself asking for its own: on a session of its own, a browser's or its command's. */
  own(c: Context<AppEnv>): Promise<AccessCaller | Response>;
  /** The agent account `:handle` names, asked about by a supervisor of it, with a session or a token; or the refusal. */
  supervising(
    c: Context<AppEnv>,
    changes: boolean,
  ): Promise<{ readonly caller: AccessCaller; readonly agent: PersonRecord } | Response>;
  /**
   * The agent account `:handle` names, read by a supervisor of it or by the account itself, as
   * `me` or by its handle, on a session of its own; or the refusal.
   */
  reading(
    c: Context<AppEnv>,
  ): Promise<{ readonly caller: AccessCaller; readonly agent: PersonRecord } | Response>;
}

export const noSuchAgent = (c: Context<AppEnv>): Response =>
  c.json(errorBody("agent.not_found", "The agent account was not found."), 404);

export function createAgentGuards(database: Database, access: Access): AgentGuards {
  const ownCommand = (c: Context<AppEnv>, message: string): Response =>
    c.json(errorBody("agent.own_command", message), 403);
  const notSupervised = (c: Context<AppEnv>): Response =>
    c.json(errorBody("auth.forbidden", "Only a supervisor of the agent account may do this."), 403);

  const found = async (c: Context<AppEnv>, caller: AccessCaller) => {
    const handle = c.req.param("handle") ?? "";
    if (!isHandle(handle) || RESERVED_HANDLES.includes(handle)) {
      return undefined;
    }
    const settings = await readWorkspaceSettings(database, caller.person.workspaceId);
    return findAgent(database, caller.person.workspaceId, handle, {
      visible: personVisibleTo(caller.person, settings),
      supervises: supervises(caller.person),
    });
  };

  const own: AgentGuards["own"] = async (c) => {
    const caller = await access.caller(c);
    if (caller === undefined) {
      return signInRequired(c);
    }
    if (caller.person.kind !== "agent") {
      return noSuchAgent(c);
    }
    if (caller.token !== undefined) {
      return ownCommand(
        c,
        "This is the account's own: asked by the account itself, signed in, not with a token it made.",
      );
    }
    return caller;
  };

  return {
    own,

    async running(c) {
      const caller = await access.caller(c);
      if (caller === undefined) {
        return signInRequired(c);
      }
      if (caller.person.kind !== "agent") {
        return noSuchAgent(c);
      }
      if (caller.command === undefined) {
        return ownCommand(
          c,
          "This is the runner's: asked by the command signed in as the account itself.",
        );
      }
      return caller;
    },

    async supervising(c, changes) {
      if (changes && !access.presentsToken(c) && !access.fromOwnPages(c)) {
        return foreignOrigin(c);
      }
      const caller = await access.caller(c);
      if (caller === undefined) {
        return signInRequired(c);
      }
      const agent = await found(c, caller);
      if (agent === undefined) {
        return noSuchAgent(c);
      }
      return agent.supervised ? { caller, agent: agent.person } : notSupervised(c);
    },

    async reading(c) {
      if (c.req.param("handle") === "me") {
        const caller = await own(c);
        return caller instanceof Response ? caller : { caller, agent: caller.person };
      }
      const caller = await access.caller(c);
      if (caller === undefined) {
        return signInRequired(c);
      }
      const agent = await found(c, caller);
      if (agent === undefined) {
        return noSuchAgent(c);
      }
      // The account reads its own by its handle too, signed in as itself.
      const itself = agent.person.id === caller.person.id && caller.token === undefined;
      return agent.supervised || itself ? { caller, agent: agent.person } : notSupervised(c);
    },
  };
}
