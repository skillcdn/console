// A plugin on the board (ADR-0052), for the tests of the board, the hooks, the jobs and what
// passes between plugins: a leave request kept as a record, its approval a decision the plugin
// raises in its board project, the answer reaching the plugin through a hook, which updates the
// record and emits an event of the plugin's own; a job that writes a page; an api another plugin
// calls; outbound requests to the one host declared. Written as the plain object definePlugin
// yields, so that it needs nothing bundled.
const argument = (type, extra = {}) => ({ type, optional: false, positional: false, ...extra });
const command = (about, args, run, roles = null) => ({ kind: "command", about, args, roles, run });
const query = (about, args, run) => ({ kind: "query", about, args, roles: null, run });

/** A schema that follows Standard Schema and takes any object: the console checks the shape, this fixture the rest. */
const anyObject = {
  "~standard": {
    version: 1,
    vendor: "fixture",
    validate: (value) =>
      typeof value === "object" && value !== null && !Array.isArray(value)
        ? { value }
        : { issues: [{ message: "an object" }] },
  },
};

const requests = {
  name: "requests",
  schema: anyObject,
  indexes: ["personId", "state", "decisionId"],
  search: [],
  owner: "personId",
  project: "none",
  read: ["approver"],
  readOwn: ["employee"],
  history: true,
};

export default {
  pluginApi: 1,
  collections: [requests],
  commands: {
    request: command(
      "Requests leave from a day to a day; the approval is a decision for the approver named.",
      {
        from: argument("day"),
        to: argument("day"),
        approver: argument("person"),
      },
      async (ctx, args) => {
        const personId = ctx.caller.kind === "person" ? ctx.caller.person.id : "";
        const record = await ctx.records(requests).create({
          personId,
          from: args.from,
          to: args.to,
          state: "requested",
          decisionId: null,
        });
        const decision = await ctx.console.decisions.ask(ctx.plugin.board.key, {
          question: `Leave from ${args.from} to ${args.to}?`,
          body: `Requested through the plugin by ${personId}.`,
          options: [
            { label: "Approve", key: "approve" },
            { label: "Reject", key: "reject" },
          ],
          deciderId: args.approver.id,
          about: { collection: "requests", id: record.id },
        });
        const updated = await ctx.records(requests).update(record.id, { decisionId: decision.id });
        return {
          text: `requested; the decision ${decision.id} waits`,
          data: { record: updated, decision },
          waiting: decision.id,
        };
      },
    ),
    task: command(
      "Leaves a task on the board and comments on it.",
      { title: argument("text", { positional: true }) },
      async (ctx, args) => {
        const task = await ctx.console.tasks.create(ctx.plugin.board.key, { title: args.title });
        const comment = await ctx.console.tasks.comment(
          ctx.plugin.board.key,
          task.number,
          "Left by leave.",
        );
        const changed = await ctx.console.tasks.update(ctx.plugin.board.key, task.number, {
          priority: "high",
        });
        return { text: `task #${task.number}`, data: { task: changed, comment } };
      },
    ),
    page: command("Writes a page under its folder, and one elsewhere.", {}, async (ctx) => {
      const own = await ctx.console.documents.write(ctx.plugin.board.key, "plugins/leave/notes", {
        title: "Leave notes",
        body: "Written by the plugin.",
      });
      let elsewhere = "written";
      try {
        await ctx.console.documents.write(ctx.plugin.board.key, "guides/leave", {
          title: "Nope",
          body: "x",
        });
      } catch (error) {
        elsewhere = error.code;
      }
      return { text: own.path, data: { own, elsewhere } };
    }),
    people: command("Reads the people and the projects the caller may see.", {}, async (ctx) => {
      const people = await ctx.console.people.list();
      let projects = "forbidden";
      try {
        projects = (await ctx.console.projects.list()).map((project) => project.key);
      } catch (error) {
        projects = error.code;
      }
      const workspace = await ctx.console.workspace();
      return {
        text: String(people.length),
        data: { people: people.map((p) => p.login), projects, workspace },
      };
    }),
    probe: command(
      "Fetches from the host declared, with the secret in a header; and from one not declared.",
      {},
      async (ctx) => {
        const answer = await ctx.fetch("https://api.example.test/ping?x=1", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ hello: "there" }),
          secret: { name: "apiToken", as: "header:x-token" },
        });
        let elsewhere = "answered";
        try {
          await ctx.fetch("https://other.example.test/");
        } catch (error) {
          elsewhere = error.code;
        }
        return {
          text: String(answer.status),
          data: { status: answer.status, body: answer.json(), headers: answer.headers, elsewhere },
        };
      },
    ),
  },
  queries: {
    mine: query("The caller's requests.", {}, async (ctx) => {
      const page = await ctx.records(requests).list({ order: { field: "id", descending: true } });
      return page.items;
    }),
  },
  endpoints: {},
  on: {
    "console:decision.answered": async (ctx, event) => {
      const decisionId = event.data.decisionId;
      if (typeof decisionId !== "string") {
        return;
      }
      const page = await ctx.records(requests).list({ where: { decisionId } });
      const record = page.items[0];
      if (record === undefined) {
        return;
      }
      // The answer is read by the key the plugin gave the option, from the event itself.
      const state = event.data.optionKey === "approve" ? "approved" : "rejected";
      await ctx.records(requests).update(record.id, { state });
      await ctx.events.emit("decided", {
        requestId: record.id,
        state,
        by: event.data.actor ?? null,
      });
    },
    // With people:read:all, the console says who left the workspace, as it happens.
    "console:person.deactivated": async (ctx, event) => {
      await ctx.events.emit("left", { login: event.data.login ?? null });
    },
  },
  jobs: {
    accrue: {
      about: "Writes the accrual page.",
      every: "PT5M",
      async run(ctx) {
        await ctx.console.documents.write(ctx.plugin.board.key, "plugins/leave/accrual", {
          title: "Accrual",
          body: `ran at ${ctx.now().toISOString()} as ${ctx.caller.kind}`,
        });
      },
    },
    broken: {
      about: "Fails every time.",
      every: "PT5M",
      async run() {
        throw new Error("the accrual is wrong");
      },
    },
  },
  upgrades: [],
  api: {
    balance: {
      about: "The days a person has left.",
      input: anyObject,
      async run(ctx, input) {
        return {
          personId: input.personId,
          days: 12,
          caller: ctx.caller.kind,
          roles: ctx.caller.roles,
        };
      },
    },
  },
  onEnable: null,
  onDisable: null,
};
