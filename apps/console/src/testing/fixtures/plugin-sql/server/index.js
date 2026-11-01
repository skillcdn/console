// A plugin with a schema of its own (docs/specs/plugins.md, "SQL"), as the plain object
// definePlugin yields: every command is one statement on ctx.sql, for the tests of the host.
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
    tally: command("Adds one to the tally.", async (ctx) => {
      const result = await ctx.sql.query("insert into tallies (note) values ($1) returning id", [
        "one",
      ]);
      return { text: `tallied ${result.rows[0].id}`, data: result.rows[0] };
    }),
    count: command("Counts the tally.", async (ctx) => {
      const result = await ctx.sql.query("select count(*)::int as n from tallies");
      return { text: `${result.rows[0].n}`, data: result.rows[0] };
    }),
    peek: command("Reads a table of the console's.", async (ctx) => {
      const result = await ctx.sql.query("select id from public.workspaces limit 1");
      return { text: `saw ${result.rowCount}` };
    }),
    flood: command("Asks for more rows than fit.", async (ctx) => {
      const result = await ctx.sql.query("select generate_series(1, 20000) as n");
      return { text: `${result.rowCount}` };
    }),
    both: command("Writes two in one transaction, then undoes a third.", async (ctx) => {
      await ctx.sql.transaction(async (tx) => {
        await tx.query("insert into tallies (note) values ($1)", ["two"]);
        await tx.query("insert into tallies (note) values ($1)", ["three"]);
      });
      try {
        await ctx.sql.transaction(async (tx) => {
          await tx.query("insert into tallies (note) values ($1)", ["undone"]);
          throw new Error("changed my mind");
        });
      } catch {
        // rolled back
      }
      const result = await ctx.sql.query("select count(*)::int as n from tallies");
      return { text: `${result.rows[0].n}` };
    }),
  },
};
