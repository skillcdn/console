// The server module: what the console runs in a thread of its own, reaching the console through
// `ctx` alone. Everything imported here is bundled into dist/server/index.js by the build.
import {
  arg,
  defineCollection,
  defineCommand,
  definePlugin,
  defineQuery,
  z,
} from "@skillcdn/console/plugin";

/** A greeting: who said what to whom. The schema is checked on every write. */
export const greetings = defineCollection("greetings", {
  schema: z.object({
    to: z.string().min(1).max(80),
    text: z.string().min(1).max(200),
    by: z.string().min(1),
  }),
  indexes: ["to", "by"],
  search: ["text"],
  owner: "by",
  read: ["greeter"],
});

export const greet = defineCommand({
  about: "Greets someone, and keeps the greeting as a record.",
  args: {
    to: arg.text({ about: "who is greeted", positional: true, max: 80 }),
    text: arg.text({
      about: "the words; the greeting setting's word and the name unless said",
      optional: true,
      max: 200,
    }),
  },
  roles: ["greeter"],
  async run(ctx, args) {
    const word =
      typeof ctx.plugin.settings.greeting === "string" ? ctx.plugin.settings.greeting : "Hello";
    const text = args.text ?? `${word}, ${args.to}!`;
    const by = ctx.caller.kind === "person" ? ctx.caller.person.login : "console";
    const record = await ctx.records(greetings).create({ to: args.to, text, by });
    await ctx.events.emit("greeted", { id: record.id, to: args.to });
    return { text: `${text} (kept as ${record.id})`, data: record };
  },
});

export const latest = defineQuery({
  about: "The latest greetings, newest first.",
  args: {
    limit: arg.number({
      about: "how many; ten unless said",
      optional: true,
      integer: true,
      min: 1,
      max: 50,
    }),
  },
  roles: ["greeter"],
  async run(ctx, args) {
    const page = await ctx.records(greetings).list({
      limit: args.limit ?? 10,
      order: { field: "id", descending: true },
    });
    return page.items;
  },
});

export default definePlugin({
  collections: [greetings],
  commands: { greet },
  queries: { latest },
});
