import type { Server } from "node:http";
import { serve } from "@hono/node-server";
import type { Logger } from "../logger.js";

export interface ServerOptions {
  readonly fetch: Parameters<typeof serve>[0]["fetch"];
  readonly host: string;
  /** `0` lets the system pick one, for tests. */
  readonly port: number;
  readonly keepAliveMs: number;
  readonly requestTimeoutMs: number;
  readonly logger: Logger;
}

export interface RunningServer {
  /** The port actually listened on. */
  readonly port: number;
  /**
   * Stops accepting, lets requests in flight finish, and resolves once every connection is
   * gone, or once the grace period is over and what is still open has been cut off.
   */
  close(graceMs: number): Promise<void>;
}

/** Listens, and resolves once it does; rejects when the port cannot be taken. */
export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const { logger } = options;
  const server = serve({
    fetch: options.fetch,
    hostname: options.host,
    port: options.port,
    serverOptions: {
      // A proxy in front reuses idle connections. If this side closes them first, the proxy
      // now and then sends a request into a connection that is already gone.
      keepAliveTimeout: options.keepAliveMs,
      requestTimeout: options.requestTimeoutMs,
      headersTimeout: Math.min(options.requestTimeoutMs, 60_000),
    },
  }) as Server;
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : options.port;

  return {
    port,
    close: (graceMs) =>
      new Promise<void>((resolve) => {
        // Whatever is still open when the grace period ends is cut off.
        const force = setTimeout(() => {
          logger.warn("grace period over; closing open connections");
          server.closeAllConnections();
        }, graceMs);
        force.unref();
        server.close(() => {
          clearTimeout(force);
          resolve();
        });
        server.closeIdleConnections();
      }),
  };
}
