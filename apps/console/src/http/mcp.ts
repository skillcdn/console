import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { MCP_ROUTE } from "@skillcdn/console/api";
import type { Context, Hono } from "hono";
import type { Database } from "../db/client.js";
import type { WorkspaceRecord } from "../db/queries/workspaces.js";
import type { Logger } from "../logger.js";
import { createAgentServer } from "../mcp/server.js";
import type { Clock } from "../ports/clock.js";
import { errorBody } from "./app.js";
import type { Access } from "./auth.js";
import type { LiveFeed } from "./live-feed.js";
import type { AppEnv } from "./request-context.js";

// Where an agent connects: the console as an MCP server over Streamable HTTP, stateless, one
// server per request, for whoever presents a token. A session cookie is not a credential here:
// an agent holds a token of its own (ADR-0004), and a browser's cookie must not drive tools.

/** A tool call is a few fields and a body of bounded Markdown; this is far above that. */
const MAX_BODY_BYTES = 1024 * 1024;

export interface McpDependencies {
  readonly database: Database;
  readonly workspace: () => Promise<WorkspaceRecord>;
  readonly access: Access;
  readonly feed: LiveFeed;
  readonly clock: Clock;
  readonly logger: Logger;
  /** How long `ask` and `await_decision` wait before saying that the decision still waits. */
  readonly waitMs: number;
}

const unauthorized = (c: Context<AppEnv>): Response => {
  c.header("www-authenticate", 'Bearer realm="console"');
  return c.json(
    errorBody(
      "auth.required",
      "Connect with a token in the Authorization header: Bearer <token>. A person makes one on their Tokens page.",
    ),
    401,
  );
};

/** The response as it is, with `close` called once its body has been sent or given up on. */
function closeWhenDone(response: Response, close: () => void): Response {
  if (response.body === null) {
    close();
    return response;
  }
  const closing = new TransformStream<Uint8Array, Uint8Array>({
    flush: () => close(),
    cancel: () => close(),
  });
  return new Response(response.body.pipeThrough(closing), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export function registerMcp(app: Hono<AppEnv>, dependencies: McpDependencies): void {
  const { database, workspace, access, feed, clock, logger, waitMs } = dependencies;

  app.all(MCP_ROUTE, async (c) => {
    if (c.req.method !== "POST") {
      // Stateless: there is no session to resume with GET, and none to end with DELETE.
      c.header("allow", "POST");
      return c.json(
        errorBody("method_not_allowed", "The MCP endpoint takes POST requests only."),
        405,
      );
    }
    if (!access.presentsToken(c)) {
      return unauthorized(c);
    }
    const caller = await access.caller(c);
    if (caller === undefined || caller.token === undefined) {
      return unauthorized(c);
    }
    const found = await workspace();
    const server = createAgentServer({
      database,
      workspaceId: found.id,
      caller: { person: caller.person, tokenId: caller.token.id },
      feed,
      clock,
      logger,
      waitMs,
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      maxRequestBodySize: MAX_BODY_BYTES,
    });
    await server.connect(transport);
    const close = () => {
      server.close().catch((error: unknown) => {
        logger.warn({ err: error, requestId: c.get("requestId") }, "an MCP server did not close");
      });
    };
    try {
      return closeWhenDone(await transport.handleRequest(c.req.raw), close);
    } catch (error) {
      close();
      throw error;
    }
  });
}
