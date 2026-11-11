// A plugin whose records changed shape twice (docs/specs/plugins.md, "Lifecycle"), as the plain
// object definePlugin yields, for the tests of the upgrades the migrate role runs: the first
// upgrade reads and writes its records through ctx, the second fails where an entry says so.
const command = (about, args, run) => ({ kind: "command", about, args, roles: null, run });
const argument = (type, extra = {}) => ({ type, optional: false, positional: false, ...extra });

/** A schema that follows Standard Schema and takes any object. */
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

const entries = {
  name: "entries",
  schema: anyObject,
  indexes: ["kind"],
  search: [],
  owner: null,
  project: "none",
  read: [],
  readOwn: [],
  history: false,
};

export default {
  pluginApi: 1,
  collections: [entries],
  commands: {
    // An entry as the first version of the plugin wrote one: a note, and nothing else.
    note: command("Keeps a note.", { words: argument("text") }, async (ctx, args) => {
      const record = await ctx.records(entries).create({ note: args.words });
      return { text: `kept ${record.id}`, data: { id: record.id } };
    }),
    all: command("Every entry, as it is kept.", {}, async (ctx) => {
      const page = await ctx.records(entries).list({ order: { field: "id" } });
      return { text: `${page.items.length}`, data: { items: page.items } };
    }),
  },
  queries: {},
  endpoints: {},
  on: {},
  jobs: {},
  upgrades: [
    {
      to: 2,
      about: "Every entry says what kind it is.",
      run: async (ctx) => {
        const page = await ctx.records(entries).list({ order: { field: "id" } });
        for (const record of page.items) {
          if (record.data.kind === undefined) {
            await ctx.records(entries).update(record.id, { kind: "note" });
          }
        }
      },
    },
    {
      to: 3,
      about: "Every entry says how long its note is.",
      run: async (ctx) => {
        const page = await ctx.records(entries).list({ order: { field: "id" } });
        for (const record of page.items) {
          if (record.data.note === "refuse the third") {
            throw new Error("an entry the upgrade cannot read");
          }
          await ctx.records(entries).update(record.id, {
            length: String(record.data.note).length,
          });
        }
      },
    },
  ],
  api: {},
  onEnable: null,
  onDisable: null,
};
