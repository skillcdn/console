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
    theirs: command(
      "Asks a decision in the language of the person it is for.",
      { approver: argument("person") },
      async (ctx, args) => {
        const { language } = await ctx.console.people.get(args.approver.id);
        const record = await ctx.records(requests).create({
          personId: ctx.caller.kind === "person" ? ctx.caller.person.id : "",
          from: "2026-12-24",
          to: "2026-12-26",
          state: "requested",
          decisionId: null,
        });
        const korean = language === "ko";
        const decision = await ctx.console.decisions.ask(ctx.plugin.board.key, {
          question: korean ? "연말 휴가를 승인할까요?" : "Leave at the year's end?",
          options: [
            { label: korean ? "승인" : "Approve", key: "approve" },
            { label: korean ? "반려" : "Reject", key: "reject" },
          ],
          deciderId: args.approver.id,
          about: { collection: "requests", id: record.id },
        });
        return { text: decision.question, data: { language, decision } };
      },
    ),
    "ask-here": command(
      "Asks the approver in the project the call is on, or in its board where the call names none.",
      { approver: argument("person") },
      async (ctx, args) => {
        const where =
          ctx.caller.kind === "person" && ctx.caller.project !== null
            ? ctx.caller.project.key
            : ctx.plugin.board.key;
        const record = await ctx.records(requests).create({
          personId: ctx.caller.kind === "person" ? ctx.caller.person.id : "",
          from: "2026-12-28",
          to: "2026-12-28",
          state: "requested",
          decisionId: null,
        });
        const decision = await ctx.console.decisions.ask(where, {
          question: "Leave on the 28th?",
          options: [
            { label: "Approve", key: "approve" },
            { label: "Reject", key: "reject" },
          ],
          deciderId: args.approver.id,
          about: { collection: "requests", id: record.id },
        });
        return { text: `asked in ${where}`, waiting: decision.id };
      },
    ),
    several: command("Writes a title in two languages at once.", {}, async (ctx) => {
      await ctx.console.tasks.create(ctx.plugin.board.key, {
        title: { en: "Settle the year's leave", ko: "연말 휴가 정산" },
      });
      return { text: "written" };
    }),
    "control-title": command("Writes a control character in a title.", {}, async (ctx) => {
      await ctx.console.tasks.create(ctx.plugin.board.key, {
        title: `제어${String.fromCodePoint(27)}문자`,
      });
      return { text: "written" };
    }),
    "control-question": command("Writes a control character in a question.", {}, async (ctx) => {
      await ctx.console.decisions.ask(ctx.plugin.board.key, {
        question: `제어${String.fromCodePoint(27)}문자`,
        options: [{ label: "Yes" }, { label: "No" }],
        about: { collection: "requests", id: "01a1b5cc-0000-7000-8000-000000000000" },
      });
      return { text: "written" };
    }),
    lines: command("Writes a body of two lines.", {}, async (ctx) => {
      await ctx.console.tasks.create(ctx.plugin.board.key, {
        title: "Two lines",
        body: "one\ntwo",
      });
      return { text: "written" };
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
      let endpoint;
      try {
        endpoint = await ctx.endpoints.url("callback");
      } catch (error) {
        endpoint = error.code;
      }
      return {
        text: String(people.length),
        data: {
          people: people.map((p) => p.login),
          // The teams (ADR-0073), and whose each person is in.
          teams: (await ctx.console.teams.list()).map((team) => team.name),
          teamsOf: Object.fromEntries(people.map((p) => [p.login, p.teams ?? []])),
          // The work email, where the plugin holds people:read:email; nothing otherwise.
          emails: Object.fromEntries(people.map((p) => [p.login, p.email ?? null])),
          projects,
          workspace,
          endpoint,
        },
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
    exchange: command(
      "Exchanges a code for tokens, which the console seals from the answer; then calls with the bot token as a bearer.",
      {},
      async (ctx) => {
        const token = await ctx.fetch("https://api.example.test/oauth/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: "grant_type=authorization_code&code=c0de",
          secrets: [{ name: "clientSecret", as: "body:client_secret" }],
          seal: {
            botToken: { path: "$.access_token", expiresIn: "$.expires_in" },
            signingSecret: "$.credentials.signing_secret",
          },
        });
        const me = await ctx.fetch("https://api.example.test/me", {
          secret: { name: "botToken", as: "bearer" },
        });
        return {
          text: "exchanged",
          data: {
            token: token.json(),
            me: me.status,
            status: await ctx.secrets.status("botToken"),
            has: await ctx.secrets.has("signingSecret"),
          },
        };
      },
    ),
    misuse: command(
      "Tries what a secret refuses: a pinned secret to another host, signing with one that verifies, a bearer past its expiry.",
      {},
      async (ctx) => {
        const codeOf = async (attempt) => {
          try {
            await attempt();
            return "sent";
          } catch (error) {
            return error.code;
          }
        };
        return {
          text: "tried",
          data: {
            pinned: await codeOf(() =>
              ctx.fetch("https://api.example.test/me", {
                secret: { name: "pinned", as: "bearer" },
              }),
            ),
            sign: await codeOf(() => ctx.secrets.sign("signingSecret", "payload", "hmac-sha256")),
            botToken: await codeOf(() =>
              ctx.fetch("https://api.example.test/me", {
                secret: { name: "botToken", as: "bearer" },
              }),
            ),
            verified: await ctx.secrets.verify("signingSecret", "payload", "0", "hmac-sha256"),
          },
        };
      },
    ),
  },
  queries: {
    standing: query("How a secret stands.", { name: argument("text") }, async (ctx, args) =>
      ctx.secrets.status(args.name),
    ),
    holds: query("The capabilities the plugin holds.", {}, async (ctx) => ctx.plugin.capabilities),
    granted: query("Who was granted a role.", { role: argument("text") }, async (ctx, args) =>
      (await ctx.console.people.granted(args.role)).map((person) => person.login),
    ),
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
        // The event's id and which delivery it was, by which a hook keeps from acting twice.
        eventId: event.id,
        attempt: event.attempt,
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
          by: ctx.caller.kind === "plugin" ? ctx.caller.plugin : null,
          for:
            ctx.caller.kind === "plugin" && ctx.caller.for !== null ? ctx.caller.for.login : null,
          language: ctx.language,
        };
      },
    },
  },
  onEnable: null,
  onDisable: null,
};
