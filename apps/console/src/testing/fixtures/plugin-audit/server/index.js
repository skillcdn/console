// A second plugin on the same board (ADR-0052): it listens to what Leave decides and leaves a
// task for each, reads Leave's tasks and may not change them, and calls Leave's api as the
// caller. Written as the plain object definePlugin yields.
const argument = (type, extra = {}) => ({ type, optional: false, positional: false, ...extra });
const command = (about, args, run) => ({ kind: "command", about, args, roles: null, run });

export default {
  pluginApi: 1,
  collections: [],
  commands: {
    peek: command(
      "Asks Leave for a person's balance, through its api.",
      { person: argument("text") },
      async (ctx, args) => {
        const leave = await ctx.plugins.get("leave");
        const balance = await leave.api.balance({ personId: args.person });
        return { text: String(balance.days), data: { version: leave.version, balance } };
      },
    ),
    read: command(
      "Reads a task of the shared board, whoever made it.",
      { number: argument("number", { integer: true }) },
      async (ctx, args) => {
        const task = await ctx.console.tasks.get(ctx.plugin.board.key, args.number);
        return { text: task === null ? "none" : task.title, data: task };
      },
    ),
    meddle: command(
      "Tries to change a task of the shared board that is not its own.",
      { number: argument("number", { integer: true }) },
      async (ctx, args) => {
        await ctx.console.tasks.update(ctx.plugin.board.key, args.number, { title: "hijacked" });
        return { text: "changed" };
      },
    ),
    nothing: command("Asks for a plugin it has no capability for.", {}, async (ctx) => {
      await ctx.plugins.get("gate");
      return { text: "got it" };
    }),
  },
  queries: {},
  endpoints: {},
  on: {
    "plugin:leave:decided": async (ctx, event) => {
      await ctx.console.tasks.create(ctx.plugin.board.key, {
        title: `Audit ${event.data.requestId}: ${event.data.state}`,
        body: `Decided on ${event.at}, told by ${event.plugin}.`,
      });
    },
  },
  jobs: {},
  upgrades: [],
  api: {},
  onEnable: null,
  onDisable: null,
};
