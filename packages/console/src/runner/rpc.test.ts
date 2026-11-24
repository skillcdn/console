import { describe, expect, it } from "vitest";
import { connectionOf, RpcError } from "./rpc.js";
import type { Child } from "./types.js";

// The connection the `acp` and the `codex` drivers speak over, against a process the test
// speaks for: what it is written, and what it answers.

function fakeChild() {
  const sent: string[] = [];
  const queue: (string | undefined)[] = [];
  let waiting: (() => void) | undefined;
  const child: Child = {
    write: async (line) => {
      sent.push(line);
    },
    end: () => undefined,
    lines: (async function* () {
      for (;;) {
        while (queue.length === 0) {
          await new Promise<void>((resolve) => {
            waiting = resolve;
          });
        }
        const line = queue.shift();
        if (line === undefined) {
          return;
        }
        yield line;
      }
    })(),
    errors: () => "",
    kill: () => undefined,
    exited: new Promise(() => undefined),
  };
  return {
    child,
    sent,
    says: (...lines: (string | undefined)[]) => {
      queue.push(...lines);
      waiting?.();
    },
  };
}

describe("the connection to a product", () => {
  it("writes a message a line under the protocol's version, and without it where the product leaves it out", async () => {
    const named = fakeChild();
    const plain = fakeChild();
    void connectionOf(named.child).request("initialize", { a: 1 });
    const connection = connectionOf(plain.child, { header: false });
    void connection.request("initialize", { a: 1 });
    await connection.notify("initialized");
    await connection.notify("session/cancel", { sessionId: "s" });
    await connection.answer(7, { decision: "decline" });
    await connection.refuse("r-1", -32601, "not offered");

    expect(named.sent.map((line) => JSON.parse(line))).toEqual([
      { jsonrpc: "2.0", id: 0, method: "initialize", params: { a: 1 } },
    ]);
    expect(plain.sent.map((line) => JSON.parse(line))).toEqual([
      { id: 0, method: "initialize", params: { a: 1 } },
      // Nothing beside the method where there is nothing to say with it.
      { method: "initialized" },
      { method: "session/cancel", params: { sessionId: "s" } },
      { id: 7, result: { decision: "decline" } },
      { id: "r-1", error: { code: -32601, message: "not offered" } },
    ]);
  });

  it("answers each request with its own answer, a refusal with what it carries beside its message", async () => {
    const fake = fakeChild();
    const connection = connectionOf(fake.child, { cut: (text, most) => text.slice(0, most) });
    const heard: unknown[] = [];
    const reading = connection.read({
      notification: (method, params) => heard.push(["said", method, params]),
      request: (id, method, params) => heard.push(["asked", id, method, params]),
    });
    const first = connection.request("thread/start", {});
    const second = connection.request("turn/steer", {});
    const third = connection.request("turn/start", {});
    fake.says(
      JSON.stringify({ id: 1, error: { code: -32600, message: "no active turn to steer" } }),
      JSON.stringify({ id: 0, result: { thread: { id: "t" } } }),
      JSON.stringify({
        id: 2,
        error: { code: -32603, message: "Internal error", data: { message: "the store is away" } },
      }),
      JSON.stringify({ method: "turn/started", params: { threadId: "t" }, emittedAtMs: 1 }),
      JSON.stringify({ id: "ask-1", method: "item/tool/requestUserInput", params: { a: 1 } }),
    );

    await expect(first).resolves.toEqual({ thread: { id: "t" } });
    await expect(second).rejects.toMatchObject({
      code: -32600,
      message: "no active turn to steer",
    });
    const refused = await third.catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(RpcError);
    expect((refused as RpcError).message).toBe("Internal error: the store is away");
    expect(heard).toEqual([
      ["said", "turn/started", { threadId: "t" }],
      ["asked", "ask-1", "item/tool/requestUserInput", { a: 1 }],
    ]);

    // Nothing answers what was asked of a process that is gone.
    const last = connection.request("turn/interrupt", {});
    fake.says(undefined);
    await reading;
    await expect(last).rejects.toThrow("the product's process ended");
  });

  it("passes over whatever is no message of the protocol, and runs none of it", async () => {
    const fake = fakeChild();
    const connection = connectionOf(fake.child);
    const heard: unknown[] = [];
    const reading = connection.read({
      notification: (method, params) => heard.push([method, params]),
      request: (id, method) => heard.push([id, method]),
    });
    const asked = connection.request("initialize", {});
    fake.says(
      "",
      "a line the product printed beside the protocol",
      "{",
      "[1,2,3]",
      "null",
      "42",
      JSON.stringify("words"),
      // An answer to nothing that was asked, and one whose id is no number.
      JSON.stringify({ id: 99, result: {} }),
      JSON.stringify({ id: "0", result: { wrong: true } }),
      JSON.stringify({ id: { $ne: 0 }, result: { wrong: true } }),
      // A method that is no text, and params that are no object.
      JSON.stringify({ method: 7, params: {} }),
      JSON.stringify({ method: "turn/completed", params: "<img src=x onerror=alert(1)>" }),
      JSON.stringify({ method: "__proto__", params: { constructor: { prototype: { x: 1 } } } }),
      `{"method":"deep","params":${"[".repeat(5000)}${"]".repeat(5000)}}`,
      `{"method":"long","params":{"text":"${"x".repeat(1_000_000)}"}}`,
      JSON.stringify({ id: 0, result: { ok: true } }),
      undefined,
    );
    await reading;

    await expect(asked).resolves.toEqual({ ok: true });
    expect(heard.map((one) => (Array.isArray(one) ? one[0] : one))).toEqual([
      "turn/completed",
      "__proto__",
      "deep",
      "long",
    ]);
    // Params that are no object arrive as none.
    expect(heard[0]).toEqual(["turn/completed", {}]);
    expect(heard[2]).toEqual(["deep", {}]);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});
