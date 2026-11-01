// A plugin that tries everything the ceiling refuses (docs/specs/plugins.md, "Security model"):
// the environment, the files, the network, processes, the way under the module system, time,
// memory, the size of an answer. Written as the plain object definePlugin yields, so that it
// needs nothing bundled; every command is one attempt. The integration test of the host proves
// each is stopped and the console answers on.
const command = (about, run) => ({ kind: "command", about, args: {}, roles: null, run });

export default {
  pluginApi: 1,
  collections: [],
  queries: {},
  endpoints: {},
  on: {},
  jobs: {},
  upgrades: [],
  api: {},
  onEnable: null,
  onDisable: null,
  commands: {
    ok: command("Answers, with what the context says.", async (ctx) => ({
      text: `hello ${ctx.caller.kind}`,
      data: { settings: ctx.plugin.settings, language: ctx.language, key: ctx.plugin.key },
    })),
    env: command("Reads the environment.", async () => ({
      text: JSON.stringify(Object.keys(process.env)),
    })),
    write: command("Writes a file beside itself.", async () => {
      const fs = await import("node:fs/promises");
      await fs.writeFile(new URL("./written.txt", import.meta.url), "x");
      return { text: "wrote" };
    }),
    read: command("Reads a file outside its directory.", async () => {
      const fs = await import("node:fs/promises");
      const bytes = await fs.readFile(process.execPath);
      return { text: String(bytes.length) };
    }),
    net: command("Opens a socket.", async () => {
      const net = await import("node:net");
      net.createConnection({ port: 1 });
      return { text: "connected" };
    }),
    spawn: command("Starts a process.", async () => {
      const cp = await import("node:child_process");
      return { text: cp.execSync("echo hi").toString() };
    }),
    worker: command("Starts a thread.", async () => {
      const wt = await import("node:worker_threads");
      return { text: String(wt.isMainThread) };
    }),
    vm: command("Runs code in a context.", async () => {
      const vm = await import("node:vm");
      return { text: String(vm.runInNewContext("1 + 1")) };
    }),
    fetch: command("Fetches from elsewhere.", async () => {
      const response = await fetch("https://example.com/");
      return { text: String(response.status) };
    }),
    binding: command("Reaches under the module system.", async () => {
      process.binding("fs");
      return { text: "bound" };
    }),
    loop: command("Loops for ever.", async () => {
      for (;;) {
        // never yields
      }
    }),
    slow: command("Waits until the console says stop.", async (ctx) => {
      await new Promise((resolve) => {
        ctx.signal.addEventListener("abort", resolve, { once: true });
      });
      return { text: "aborted" };
    }),
    memory: command("Eats memory.", async () => {
      const kept = [];
      for (;;) {
        kept.push(new Array(1_000_000).fill(1));
      }
    }),
    big: command("Answers more than fits.", async () => ({ text: "x".repeat(5 * 1024 * 1024) })),
    exit: command("Ends the process.", async () => {
      process.exit(0);
    }),
    throw: command("Fails with a detail nobody should read.", async () => {
      throw new Error("the secret detail");
    }),
    refuse: command("Refuses in its own words.", async () => {
      const error = new Error("Ten days at most.");
      error.name = "PluginError";
      error.code = "over_limit";
      throw error;
    }),
    log: command("Logs more than the bound.", async (ctx) => {
      for (let i = 0; i < 150; i += 1) {
        ctx.log.info(`line ${i}`);
      }
      return { text: "logged" };
    }),
    secret: command("Signs with a secret it never sees.", async (ctx) => ({
      text: await ctx.secrets.sign("token", "payload", "hmac-sha256"),
    })),
    records: command("Reaches for records.", async (ctx) => {
      const page = await ctx.records("things").list();
      return { text: String(page.items.length) };
    }),
    emit: command("Emits an event of its own.", async (ctx) => {
      await ctx.events.emit("tried", { what: "emit" });
      return { text: "emitted" };
    }),
  },
};
