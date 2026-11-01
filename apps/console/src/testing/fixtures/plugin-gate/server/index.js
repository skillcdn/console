// A plugin for the tests of the command and the routes (docs/specs/plugins.md, "The command"):
// arguments of every kind, parsed from the words the console is sent; a command that waits for a
// decision; what the caller is; a query that answers a file; an endpoint for a person and one for
// a webhook, which verifies the signature with a secret it never sees. Written as the plain
// object definePlugin yields, so that it needs nothing bundled.
const argument = (type, extra = {}) => ({ type, optional: false, positional: false, ...extra });

const command = (about, args, run, roles = null) => ({ kind: "command", about, args, roles, run });
const query = (about, args, run) => ({ kind: "query", about, args, roles: null, run });

export default {
  pluginApi: 1,
  collections: [],
  on: {},
  jobs: {},
  upgrades: [],
  api: {},
  onEnable: null,
  onDisable: null,
  commands: {
    plan: command(
      "Plans a thing, with every kind of argument.",
      {
        title: argument("text", { positional: true, max: 80, about: "what is planned" }),
        when: argument("day", { optional: true }),
        count: argument("number", { optional: true, integer: true, min: 1, max: 10 }),
        tags: argument("list", { optional: true, of: argument("text") }),
        urgent: argument("boolean", { optional: true }),
        kind: argument("enum", { optional: true, options: ["small", "large"] }),
        who: argument("person", { optional: true }),
        where: argument("project", { optional: true }),
        attachment: argument("file", { optional: true }),
        note: argument("markdown", { optional: true }),
        token: argument("text", { optional: true, secret: true }),
      },
      async (ctx, args) => ({
        text: `planned ${args.title}${args.urgent ? " (urgent)" : ""}`,
        data: { args, caller: ctx.caller },
      }),
    ),
    wait: command("Raises a decision and waits for it.", {}, async () => ({
      text: "waiting for the boss",
      waiting: "0199c4d8-0000-7000-8000-0000000000d1",
    })),
    decide: command("Decides; for the boss alone.", {}, async () => ({ text: "decided" }), [
      "boss",
    ]),
  },
  queries: {
    echo: query(
      "Answers its arguments and the caller.",
      { n: argument("number", { optional: true }) },
      async (ctx, args) => ({
        args,
        caller: ctx.caller,
        project: ctx.plugin.board,
      }),
    ),
    report: query("Answers a file.", {}, async () => ({
      file: { name: "report.csv", type: "text/csv", bytes: new TextEncoder().encode("a,b\n1,2\n") },
    })),
  },
  endpoints: {
    ping: {
      kind: "endpoint",
      auth: "person",
      roles: null,
      secret: null,
      methods: ["GET", "POST"],
      headers: ["x-note"],
      async run(ctx, request) {
        return {
          status: 200,
          headers: { "cache-control": "no-store" },
          body: {
            method: request.method,
            path: request.path,
            query: request.query,
            headers: request.headers,
            body: request.body,
            caller: ctx.caller,
          },
        };
      },
    },
    inbound: {
      kind: "endpoint",
      auth: "webhook",
      roles: null,
      secret: "signing",
      methods: ["POST"],
      headers: ["x-signature"],
      async run(ctx, request) {
        const good = await ctx.secrets.verify(
          "signing",
          request.body,
          request.headers["x-signature"] ?? "",
          "hmac-sha256",
        );
        if (!good) {
          return { status: 401, body: "bad signature" };
        }
        return {
          status: 202,
          headers: { location: "/nowhere" },
          body: { ok: true, caller: ctx.caller.kind, roles: ctx.caller.roles },
        };
      },
    },
    leaky: {
      kind: "endpoint",
      auth: "person",
      roles: null,
      secret: null,
      methods: ["GET"],
      headers: [],
      async run() {
        return {
          status: 200,
          headers: { "set-cookie": "x=1", "content-type": "text/html" },
          body: "<b>hi</b>",
        };
      },
    },
  },
};
