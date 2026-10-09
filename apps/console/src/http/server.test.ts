import { Agent, request } from "node:http";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { startServer } from "./server.js";

const logger = pino({ level: "silent" });

describe("startServer", () => {
  it("listens on a port the system picks, answers, and closes with its idle connections", async () => {
    const server = await startServer({
      fetch: () => new Response("hello"),
      host: "127.0.0.1",
      port: 0,
      keepAliveMs: 65_000,
      requestTimeoutMs: 10_000,
      logger,
    });
    expect(server.port).toBeGreaterThan(0);
    const response = await fetch(`http://127.0.0.1:${server.port}/`);
    expect(await response.text()).toBe("hello");

    // A keep-alive connection left idle by a client would hold `close` until the keep-alive
    // timeout; closing idle connections lets the server go at once.
    const agent = new Agent({ keepAlive: true });
    await new Promise<void>((resolve, reject) => {
      request({ host: "127.0.0.1", port: server.port, path: "/", agent }, (reply) => {
        reply.resume();
        reply.once("end", resolve);
      })
        .once("error", reject)
        .end();
    });
    const started = Date.now();
    await server.close(5_000);
    expect(Date.now() - started).toBeLessThan(2_000);
    agent.destroy();
    await expect(fetch(`http://127.0.0.1:${server.port}/`)).rejects.toThrow();
  });

  it("cuts off what is still open once the grace period is over", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const server = await startServer({
      fetch: async () => {
        await held;
        return new Response("late");
      },
      host: "127.0.0.1",
      port: 0,
      keepAliveMs: 65_000,
      requestTimeoutMs: 10_000,
      logger,
    });
    const pending = fetch(`http://127.0.0.1:${server.port}/`).catch((error: unknown) => error);
    // Give the request time to reach the handler before shutting down.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const started = Date.now();
    await server.close(300);
    expect(Date.now() - started).toBeLessThan(2_000);
    release();
    await pending;
  });

  it("rejects when the port is taken", async () => {
    const first = await startServer({
      fetch: () => new Response(""),
      host: "127.0.0.1",
      port: 0,
      keepAliveMs: 1000,
      requestTimeoutMs: 1000,
      logger,
    });
    await expect(
      startServer({
        fetch: () => new Response(""),
        host: "127.0.0.1",
        port: first.port,
        keepAliveMs: 1000,
        requestTimeoutMs: 1000,
        logger,
      }),
    ).rejects.toThrow();
    await first.close(1000);
  });
});
