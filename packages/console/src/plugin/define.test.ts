import { describe, expect, it } from "vitest";
import * as z from "zod";
import { arg } from "./args.js";
import type { PluginContext } from "./context.js";
import {
  defineCollection,
  defineCommand,
  defineEndpoint,
  definePlugin,
  defineQuery,
  describePlugin,
  descriptionProblems,
  durationMs,
  isPluginDefinition,
  isQueryFile,
} from "./define.js";
import { PluginDefinitionError } from "./definition-error.js";

const requests = defineCollection("requests", {
  schema: z.object({
    personId: z.string(),
    state: z.enum(["requested", "approved"]),
    days: z.number(),
  }),
  indexes: ["personId", "state"],
  search: ["personId"],
  owner: "personId",
  read: ["approver"],
  readOwn: ["employee"],
});

const request = defineCommand({
  about: "Requests leave.",
  args: { from: arg.day({ positional: true }), reason: arg.text({ optional: true }) },
  roles: ["employee"],
  async run(ctx, args) {
    const record = await ctx
      .records(requests)
      .create({ personId: "p", state: "requested", days: 1 });
    return { text: `${args.from} ${args.reason ?? ""} ${record.data.state}` };
  },
});

const balance = defineQuery({
  about: "The days left.",
  args: { person: arg.person({ optional: true }) },
  async run() {
    return { days: 10 };
  },
});

const plugin = definePlugin({
  collections: [requests],
  commands: { request },
  queries: { balance },
  endpoints: {
    hook: defineEndpoint({
      auth: "webhook",
      secret: "token",
      async run() {
        return { status: 204 };
      },
    }),
  },
  on: { "console:decision.answered": async () => {}, "plugin:crm:deal-won": async () => {} },
  jobs: { accrue: { about: "Adds the days.", every: "P1D", at: "02:00", run: async () => {} } },
  upgrades: [{ to: 2, about: "Splits the days.", run: async () => {} }],
  api: {
    balance: {
      about: "The days left.",
      input: z.object({ personId: z.string() }),
      run: async () => 10,
    },
  },
  async onEnable() {},
});

const MANIFEST = {
  roles: { employee: {}, approver: {} },
  capabilities: ["endpoints", "events:console", "events:plugins", "jobs"],
  settings: [{ key: "token", type: "secret" }],
  dataVersion: 2,
};

describe("definePlugin", () => {
  it("yields a definition the host recognizes, with every part filled", () => {
    expect(isPluginDefinition(plugin)).toBe(true);
    expect(plugin.pluginApi).toBe(1);
    expect(plugin.onDisable).toBeNull();
    expect(Object.isFrozen(plugin)).toBe(true);
    expect(isPluginDefinition({ pluginApi: 1 })).toBe(false);
    expect(isPluginDefinition(null)).toBe(false);
  });

  it("describes itself as JSON, functions and schemas left behind", () => {
    const description = describePlugin(plugin);
    expect(JSON.parse(JSON.stringify(description))).toEqual(description);
    expect(description.collections).toEqual([
      {
        name: "requests",
        indexes: ["personId", "state"],
        search: ["personId"],
        owner: "personId",
        project: "none",
        read: ["approver"],
        readOwn: ["employee"],
        history: true,
      },
    ]);
    expect(description.commands.request).toEqual({
      about: "Requests leave.",
      args: {
        from: { type: "day", optional: false, positional: true },
        reason: { type: "text", optional: true, positional: false },
      },
      roles: ["employee"],
    });
    expect(description.queries.balance?.roles).toBeNull();
    expect(description.endpoints.hook).toEqual({
      auth: "webhook",
      roles: null,
      secret: "token",
      methods: ["POST"],
      headers: [],
    });
    expect(description.hooks).toEqual(["console:decision.answered", "plugin:crm:deal-won"]);
    expect(description.jobs.accrue).toEqual({ about: "Adds the days.", every: "P1D", at: "02:00" });
    expect(description.upgrades).toEqual([{ to: 2, about: "Splits the days." }]);
    expect(description.api).toEqual({ balance: { about: "The days left." } });
    expect(description.onEnable).toBe(true);
    expect(description.onDisable).toBe(false);
  });

  it("holds the description to the manifest", () => {
    expect(descriptionProblems(describePlugin(plugin), MANIFEST)).toEqual([]);
    expect(
      descriptionProblems(describePlugin(plugin), { ...MANIFEST, roles: { employee: {} } }),
    ).toEqual([
      "the collection requests's read names the role approver, which the manifest does not declare",
    ]);
    expect(descriptionProblems(describePlugin(plugin), { ...MANIFEST, capabilities: [] })).toEqual([
      "the endpoint hook needs the capability endpoints, which the manifest does not declare",
      "the hook console:decision.answered needs the capability events:console, which the manifest does not declare",
      "the hook plugin:crm:deal-won needs the capability events:plugins, which the manifest does not declare",
      "the job accrue needs the capability jobs, which the manifest does not declare",
    ]);
    expect(descriptionProblems(describePlugin(plugin), { ...MANIFEST, settings: [] })[0]).toMatch(
      /verifies with the setting token/,
    );
    expect(descriptionProblems(describePlugin(plugin), { ...MANIFEST, dataVersion: 1 })[0]).toMatch(
      /dataVersion is 1 and the upgrades reach 2/,
    );
    const withRecordArg = definePlugin({
      commands: {
        cancel: defineCommand({
          about: "Cancels.",
          args: { id: arg.record("requests") },
          run: async () => ({ text: "" }),
        }),
      },
    });
    expect(
      descriptionProblems(describePlugin(withRecordArg), { ...MANIFEST, dataVersion: 1 }),
    ).toEqual([
      "the command cancel's argument id names the collection requests, which is not defined",
    ]);
  });

  it("refuses what the console cannot hold, naming every problem", () => {
    const problemsOf = (parts: Parameters<typeof definePlugin>[0]): readonly string[] => {
      try {
        definePlugin(parts);
        return [];
      } catch (error) {
        if (error instanceof PluginDefinitionError) {
          return error.problems;
        }
        throw error;
      }
    };
    expect(problemsOf({ commands: { help: request } })).toEqual([
      "help is a subcommand of console plugin <key>, and not a name for a command or a query",
    ]);
    expect(problemsOf({ commands: { request }, queries: { request: balance } })).toEqual([
      "a command and a query have one name",
    ]);
    expect(problemsOf({ commands: { Request: request } })).toEqual([
      'the command "Request" is not named as a key',
    ]);
    expect(problemsOf({ commands: { fake: { kind: "query" } as never } })).toEqual([
      "the command fake is not from defineCommand",
    ]);
    expect(problemsOf({ on: { "decision.answered": async () => {} } })).toEqual([
      'the hook "decision.answered" is neither console:<kind> nor plugin:<key>:<kind>',
    ]);
    expect(
      problemsOf({
        jobs: { fast: { about: "Too often.", every: "PT1M", run: async () => {} } },
      })[0],
    ).toMatch(/five minutes or more/);
    expect(
      problemsOf({
        jobs: { timed: { about: "Hourly at.", every: "PT1H", at: "02:00", run: async () => {} } },
      })[0],
    ).toMatch(/has at/);
    expect(problemsOf({ upgrades: [{ to: 3, about: "Skips.", run: async () => {} }] })[0]).toMatch(
      /one dataVersion at a time/,
    );
    expect(problemsOf({ collections: [requests, requests] })).toEqual([
      "two collections have one name",
    ]);
    expect(
      problemsOf({ api: { sum: { about: "No schema.", input: {} as never, run: async () => 1 } } }),
    ).toEqual(["the api call sum needs input, a zod schema"]);
  });
});

describe("an argument's name", () => {
  it("is not a flag the command keeps for itself", () => {
    expect(() =>
      defineCommand({
        about: "Takes a file by a name the command uses.",
        args: { file: arg.text() },
        async run() {
          return { text: "" };
        },
      }),
    ).toThrow(/the argument "file", a flag the command keeps for itself/);
  });
});

describe("the definers", () => {
  it("refuse what is not a definition", () => {
    expect(() => defineCollection("Requests", { schema: z.object({}) })).toThrow(
      PluginDefinitionError,
    );
    expect(() => defineCollection("requests", { schema: {} as never })).toThrow(
      PluginDefinitionError,
    );
    expect(() =>
      defineCollection("requests", {
        schema: z.object({}),
        indexes: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
      }),
    ).toThrow(/indexes 9 fields/);
    expect(() => defineCollection("requests", { schema: z.object({}), owner: "personId" })).toThrow(
      /must be indexed/,
    );
    expect(() =>
      defineCollection("requests", { schema: z.object({}), readOwn: ["employee"] }),
    ).toThrow(/no owner field/);
    expect(() => defineCommand({ about: "", run: async () => ({ text: "" }) })).toThrow(
      PluginDefinitionError,
    );
    expect(() =>
      defineCommand({
        about: "x",
        args: {
          a: arg.text({ positional: true, optional: true }),
          b: arg.text({ positional: true }),
        },
        run: async () => ({ text: "" }),
      }),
    ).toThrow(/positional and required after an optional one/);
    expect(() => defineQuery({ about: "x", roles: [], run: async () => 1 })).toThrow(
      /leave roles out/,
    );
    expect(() =>
      defineEndpoint({ auth: "webhook", roles: ["a"], run: async () => ({ status: 200 }) }),
    ).toThrow(/names no roles/);
    expect(() =>
      defineEndpoint({ auth: "person", secret: "token", run: async () => ({ status: 200 }) }),
    ).toThrow(/for a webhook alone/);
    expect(() =>
      defineEndpoint({ auth: "person", methods: ["TRACE"], run: async () => ({ status: 200 }) }),
    ).toThrow(/methods are among/);
  });

  it("fill what is left out", () => {
    const collection = defineCollection("notes", { schema: z.object({ text: z.string() }) });
    expect(collection).toMatchObject({
      indexes: [],
      search: [],
      owner: null,
      project: "none",
      read: [],
      readOwn: [],
      history: true,
    });
    const endpoint = defineEndpoint({
      auth: "person",
      roles: ["employee"],
      methods: ["GET"],
      headers: ["x-request-id"],
      run: async () => ({ status: 200 }),
    });
    expect(endpoint).toMatchObject({
      kind: "endpoint",
      secret: null,
      methods: ["GET"],
      headers: ["x-request-id"],
    });
    const query = defineQuery({ about: "No args.", run: async () => 1 });
    expect(query.args).toEqual({});
  });

  it("type the arguments and the records from the definitions", async () => {
    const seen: unknown[] = [];
    const ctx = {
      records: () => ({ create: async (data: unknown) => ({ data }) }),
    } as unknown as PluginContext;
    const result = await request.run(ctx, { from: "2026-11-01" });
    seen.push(result.text);
    expect(result.text).toBe("2026-11-01  requested");
  });
});

describe("isQueryFile", () => {
  it("tells a file answer from JSON", () => {
    expect(
      isQueryFile({ file: { name: "a.csv", type: "text/csv", bytes: new Uint8Array(1) } }),
    ).toBe(true);
    expect(isQueryFile({ file: { name: "a.csv", type: "text/csv", bytes: "x" } })).toBe(false);
    expect(isQueryFile([{ file: 1 }])).toBe(false);
    expect(isQueryFile(null)).toBe(false);
  });
});

describe("durationMs", () => {
  it("reads ISO 8601 durations", () => {
    expect(durationMs("P1D")).toBe(86_400_000);
    expect(durationMs("PT5M")).toBe(300_000);
    expect(durationMs("P1W")).toBe(7 * 86_400_000);
    expect(durationMs("P1DT12H")).toBe(36 * 3_600_000);
    expect(durationMs("P")).toBeUndefined();
    expect(durationMs("PT")).toBeUndefined();
    expect(durationMs("1D")).toBeUndefined();
  });
});
