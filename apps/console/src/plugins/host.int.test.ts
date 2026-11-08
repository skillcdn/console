import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import {
  type PluginCaller,
  type PluginDescription,
  type PluginInfo,
  PluginRefusal,
} from "@skillcdn/console/plugin";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EVIL_PLUGIN_DIR,
  HELLO_PLUGIN_DIR,
  HOST_ENTRY,
  hostEnvironment,
  writePluginsDir,
} from "../testing/plugins.js";
import { discoverPlugins } from "./discovery.js";
import { type ContextCall, PluginHost } from "./host.js";
import { allowedReadRoots } from "./paths.js";
import type { CallKind, PluginCall } from "./protocol.js";

// The host against a plugin that tries everything the ceiling refuses (docs/specs/plugins.md,
// "Security model"): each attempt is stopped, and the console answers on. Needs the compiled
// host (dist/plugins/plugin-host.js) and the example plugin built by its workspace.

let root: string;
let host: PluginHost;
const logs: Record<string, unknown>[] = [];
const contextCalls: ContextCall[] = [];
const described = new Map<string, PluginDescription>();

const INFO: PluginInfo = {
  key: "evil",
  version: "0.0.1",
  dataVersion: 1,
  settings: { greeting: "Hi" },
  capabilities: [],
  grants: [],
  board: null,
  projects: "all",
};
const PERSON: PluginCaller = {
  kind: "person",
  person: { id: "p1", login: "alice", name: "Alice", language: "ko", admin: false },
  agent: null,
  roles: ["greeter"],
  run: null,
  project: null,
};

const callOf = (
  kind: CallKind,
  name: string,
  payload: unknown = {},
  timeoutMs = 5_000,
): PluginCall => ({
  kind,
  name,
  payload,
  info: INFO,
  caller: PERSON,
  language: "ko",
  timeoutMs,
});

const evil = (name: string, timeoutMs?: number) =>
  host.call("evil", callOf("command", name, {}, timeoutMs));

beforeAll(async () => {
  root = await writePluginsDir(await mkdtemp(join(tmpdir(), "console-plugins-")), [
    { name: "console-plugin-hello", dir: HELLO_PLUGIN_DIR },
    { name: "console-plugin-evil", dir: EVIL_PLUGIN_DIR },
  ]);
  host = new PluginHost({
    entry: HOST_ENTRY,
    allowRead: await allowedReadRoots(root),
    env: hostEnvironment(process.env),
    logger: pino(
      { level: "debug" },
      { write: (line: string) => logs.push(JSON.parse(line) as Record<string, unknown>) },
    ),
    onContext: async (call) => {
      contextCalls.push(call);
      if (call.member === "secrets" && call.method === "sign") {
        return "deadbeef";
      }
      if (call.member === "events" && call.method === "emit") {
        return null;
      }
      throw new PluginRefusal(
        "plugin.forbidden",
        `${call.member}.${call.method} is not allowed here`,
      );
    },
  });
  await host.start();
  const discovered = await discoverPlugins(root);
  expect(discovered.failed).toEqual([]);
  for (const plugin of discovered.plugins) {
    const reply = await host.load({
      key: plugin.key,
      server: join(plugin.dir, plugin.manifest.server),
      version: plugin.version,
      memoryMb: 64,
    });
    if (!reply.ok) {
      throw new Error(`${plugin.key} did not load: ${reply.error} ${reply.problems.join("; ")}`);
    }
    described.set(plugin.key, reply.description);
  }
}, 90_000);

afterAll(async () => {
  await host?.stop();
  if (root !== undefined) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("the plugin host", () => {
  it("describes the plugins it loaded, under the host's hardening", () => {
    const hello = described.get("hello");
    expect(hello?.collections.map((collection) => collection.name)).toEqual(["greetings"]);
    expect(Object.keys(hello?.commands ?? {})).toEqual(["greet"]);
    expect(Object.keys(hello?.queries ?? {})).toEqual(["latest"]);
    expect(Object.keys(described.get("evil")?.commands ?? {})).toContain("loop");
  });

  it("runs a command with the words of its context", async () => {
    const result = await evil("ok");
    expect(result).toEqual({
      ok: true,
      value: {
        text: "hello person",
        data: { settings: { greeting: "Hi" }, language: "ko", key: "evil" },
      },
    });
  });

  it("shows a plugin no environment", async () => {
    const result = await evil("env");
    expect(result.ok).toBe(true);
    expect(JSON.parse((result as { value: { text: string } }).value.text)).toEqual([]);
  });

  it("refuses files, the network, processes, threads, contexts, fetch and the way under the module system", async () => {
    for (const name of [
      "write",
      "read",
      "net",
      "builtin",
      "legacy",
      "legacy-tls",
      "require",
      "load",
      "spawn",
      "worker",
      "vm",
      "fetch",
      "binding",
    ]) {
      const result = await evil(name);
      expect(result, name).toEqual({
        ok: false,
        error: { code: "plugin.failed", message: "the plugin's code failed" },
      });
    }
    const written = await import("node:fs/promises").then((fs) =>
      fs
        .stat(join(root, "node_modules", "console-plugin-evil", "server", "written.txt"))
        .catch(() => null),
    );
    expect(written).toBeNull();
  });

  it("ends a call that runs past its time, and answers the next", async () => {
    const result = await evil("loop", 1_000);
    expect(result).toMatchObject({ ok: false, error: { code: "plugin.timeout" } });
    expect(await evil("ok")).toMatchObject({ ok: true });
  }, 20_000);

  it("fires the call's signal before ending it", async () => {
    const result = await evil("slow", 500);
    expect(result).toEqual({ ok: true, value: { text: "aborted" } });
  });

  it("ends a thread that grows past its memory, and starts it afresh", async () => {
    const result = await evil("memory", 20_000);
    expect(result).toMatchObject({ ok: false, error: { code: "plugin.unavailable" } });
    expect(await evil("ok")).toMatchObject({ ok: true });
  }, 40_000);

  it("refuses an answer over the bound", async () => {
    const result = await evil("big");
    expect(result).toMatchObject({ ok: false, error: { code: "plugin.too_many" } });
  });

  it("survives a thread that ends itself", async () => {
    const result = await evil("exit");
    expect(result).toMatchObject({ ok: false, error: { code: "plugin.unavailable" } });
    expect(await evil("ok")).toMatchObject({ ok: true });
  });

  it("hides what a failure says, logs it, and keeps a plugin's own refusal", async () => {
    const failed = await evil("throw");
    expect(failed).toEqual({
      ok: false,
      error: { code: "plugin.failed", message: "the plugin's code failed" },
    });
    expect(JSON.stringify(failed)).not.toContain("secret detail");
    expect(
      logs.some(
        (line) =>
          line.plugin === "evil" &&
          line.level === 50 &&
          String(line.error).includes("the secret detail"),
      ),
    ).toBe(true);
    const refused = await evil("refuse");
    expect(refused).toEqual({
      ok: false,
      error: { code: "plugin.evil.over_limit", message: "Ten days at most." },
    });
  });

  it("carries a call on ctx to the parent, and the parent's refusal back", async () => {
    expect(await evil("secret")).toEqual({ ok: true, value: { text: "deadbeef" } });
    expect(contextCalls.at(-1)).toMatchObject({
      plugin: "evil",
      member: "secrets",
      method: "sign",
      args: ["token", "payload", "hmac-sha256"],
    });
    expect(contextCalls.at(-1)?.call.caller).toEqual(PERSON);
    expect(await evil("records")).toEqual({
      ok: false,
      error: { code: "plugin.forbidden", message: "records.list is not allowed here" },
    });
    expect(await evil("emit")).toEqual({ ok: true, value: { text: "emitted" } });
  });

  it("writes a plugin's log lines with its key, up to the bound a minute", async () => {
    expect(await evil("log")).toEqual({ ok: true, value: { text: "logged" } });
    const lines = logs.filter(
      (line) =>
        line.plugin === "evil" && typeof line.msg === "string" && line.msg.startsWith("line "),
    );
    expect(lines.length).toBeLessThanOrEqual(100);
    expect(lines.length).toBeGreaterThan(0);
    expect(
      logs.some(
        (line) =>
          line.plugin === "evil" && String(line.msg).includes("more than 100 lines a minute"),
      ),
    ).toBe(true);
  });

  it("answers unavailable for a plugin it does not hold, and for an unknown command", async () => {
    expect(await host.call("nobody", callOf("command", "ok"))).toMatchObject({
      ok: false,
      error: { code: "plugin.unavailable" },
    });
    expect(await evil("nothing")).toMatchObject({ ok: false, error: { code: "plugin.not_found" } });
  });
});
