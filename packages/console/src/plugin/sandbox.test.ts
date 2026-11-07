import { builtinModules } from "node:module";
import { describe, expect, it } from "vitest";
import {
  forbiddenImportsIn,
  forbiddingResolve,
  isForbiddenBuiltin,
  removedGlobalsIn,
} from "./sandbox.js";

describe("isForbiddenBuiltin", () => {
  it("refuses the network, processes and the way under the module system, with or without node:", () => {
    for (const name of [
      "net",
      "node:http",
      "https",
      "node:child_process",
      "worker_threads",
      "vm",
      "node:dns/promises",
      "v8",
    ]) {
      expect(isForbiddenBuiltin(name)).toBe(true);
    }
    for (const name of [
      "node:fs",
      "fs/promises",
      "node:crypto",
      "node:path",
      "zod",
      "./other.js",
    ]) {
      expect(isForbiddenBuiltin(name)).toBe(false);
    }
  });
});

describe("forbiddenImportsIn", () => {
  it("has looked at every built-in of this Node", () => {
    // What a plugin's thread may load: none reaches the network, a process or a thread, and what
    // reads or writes a file answers to the permission model. A built-in a new Node brings fails
    // here until someone says which it is.
    const reachesNothing = new Set([
      "_stream_duplex",
      "_stream_passthrough",
      "_stream_readable",
      "_stream_transform",
      "_stream_wrap",
      "_stream_writable",
      "assert",
      "assert/strict",
      "async_hooks",
      "buffer",
      "console",
      "constants",
      "crypto",
      "diagnostics_channel",
      "domain",
      "events",
      "fs",
      "fs/promises",
      "module",
      "os",
      "path",
      "path/posix",
      "path/win32",
      "perf_hooks",
      "process",
      "punycode",
      "querystring",
      "readline",
      "readline/promises",
      "sea",
      "sqlite",
      "stream",
      "stream/consumers",
      "stream/promises",
      "stream/web",
      "string_decoder",
      "sys",
      "test",
      "test/reporters",
      "timers",
      "timers/promises",
      "trace_events",
      "tty",
      "url",
      "util",
      "util/types",
      "zlib",
    ]);
    const unseen = builtinModules
      .map((name) => name.replace(/^node:/, ""))
      .filter((name) => !isForbiddenBuiltin(name) && !reachesNothing.has(name));
    expect(unseen).toEqual([]);
  });

  it("finds every form of import in a bundle's text", () => {
    const source = `
      import net from "node:net";
      import { request } from 'https';
      const cp = require("child_process");
      const dns = await import(\`node:dns\`);
      const ok = require("node:fs");
      process.getBuiltinModule("node:vm");
    `;
    expect(forbiddenImportsIn(source).sort()).toEqual([
      "child_process",
      "https",
      "node:dns",
      "node:net",
      "node:vm",
    ]);
    expect(forbiddenImportsIn('import { z } from "zod"; import fs from "node:fs";')).toEqual([]);
  });
});

describe("removedGlobalsIn", () => {
  it("finds calls of what the host removes", () => {
    expect(
      removedGlobalsIn(
        'await fetch("https://x"); new WebSocket("wss://x"); process.binding("fs")',
      ).sort(),
    ).toEqual(["WebSocket", "fetch", "process.binding"]);
    expect(removedGlobalsIn("ctx.fetch(url)")).toEqual(["fetch"]);
    expect(removedGlobalsIn("const fetched = 1; prefetch(x)")).toEqual([]);
  });
});

describe("forbiddingResolve", () => {
  it("refuses the forbidden built-ins with a code, and lets the rest resolve", () => {
    const next = (specifier: string, context: { parentURL: string }) => ({
      url: specifier,
      from: context.parentURL,
    });
    expect(forbiddingResolve("node:fs", { parentURL: "file:///plugin.js" }, next)).toEqual({
      url: "node:fs",
      from: "file:///plugin.js",
    });
    expect(forbiddingResolve("zod", { parentURL: "" }, next)).toEqual({ url: "zod", from: "" });
    expect(() => forbiddingResolve("node:http", { parentURL: "" }, next)).toThrow(
      /the host refuses node:http/,
    );
    try {
      forbiddingResolve("child_process", { parentURL: "" }, next);
    } catch (error) {
      expect((error as { code?: string }).code).toBe("ERR_PLUGIN_FORBIDDEN_BUILTIN");
    }
  });
});
