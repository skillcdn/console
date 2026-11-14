// A plugin that keeps a token per workspace of a chat service (ADR-0111), for the tests of the
// keyed secrets: an installation sealed under the workspace the service's answer names, a request
// with one workspace's token, the keys it keeps, one forgotten, one moved from before the setting
// was keyed, and the calls a keyed secret refuses. Written as the plain object definePlugin yields.
const argument = (type, extra = {}) => ({ type, optional: false, positional: false, ...extra });

const command = (about, args, run) => ({ kind: "command", about, args, roles: null, run });

const SERVICE = "https://chat.example.test";

const team = { team: argument("text", { positional: true, about: "the workspace's id" }) };

/** The code a call was refused with, or `ok`. */
const codeOf = async (call) => {
  try {
    await call();
    return "ok";
  } catch (error) {
    return error?.code ?? "thrown";
  }
};

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
    install: command(
      "Exchanges an installation's code for its token, sealed under the workspace it names.",
      { code: argument("text", { positional: true, about: "the code of the installation" }) },
      async (ctx, args) => {
        const answer = await ctx.fetch(`${SERVICE}/oauth.access`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ code: args.code }),
          seal: { tokens: { path: "$.access_token", key: "$.team.id", expiresIn: "$.expires_in" } },
        });
        return { text: answer.sealed?.tokens ?? "none", data: answer.json() };
      },
    ),
    post: command("Posts in a workspace with its token.", team, async (ctx, args) => {
      const answer = await ctx.fetch(`${SERVICE}/echo`, {
        method: "POST",
        secret: { name: "tokens", key: args.team, as: "bearer" },
      });
      return { text: String(answer.status), data: answer.json() };
    }),
    keys: command("Lists the workspaces a token is kept for.", {}, async (ctx) => ({
      text: "keys",
      data: await ctx.secrets.keys("tokens"),
    })),
    standing: command("Says how a workspace's token stands.", team, async (ctx, args) => ({
      text: "standing",
      data: {
        has: await ctx.secrets.has("tokens", args.team),
        status: await ctx.secrets.status("tokens", args.team),
        unkeyed: await ctx.secrets.has("tokens"),
      },
    })),
    forget: command("Forgets a workspace's token.", team, async (ctx, args) => ({
      text: "forgotten",
      data: await ctx.secrets.forget("tokens", args.team),
    })),
    move: command("Keeps the token of before under a workspace.", team, async (ctx, args) => ({
      text: "moved",
      data: await ctx.secrets.move("tokens", args.team),
    })),
    misuse: command("Tries what a keyed secret refuses.", {}, async (ctx) => ({
      text: "tried",
      data: {
        fetchWithoutKey: await codeOf(() =>
          ctx.fetch(`${SERVICE}/echo`, { secret: { name: "tokens", as: "bearer" } }),
        ),
        fetchWithKeyOfOne: await codeOf(() =>
          ctx.fetch(`${SERVICE}/echo`, { secret: { name: "apiKey", key: "T1", as: "bearer" } }),
        ),
        fetchWithBadKey: await codeOf(() =>
          ctx.fetch(`${SERVICE}/echo`, { secret: { name: "tokens", key: "a b", as: "bearer" } }),
        ),
        sealWithoutKey: await codeOf(() =>
          ctx.fetch(`${SERVICE}/oauth.access`, { seal: { tokens: "$.access_token" } }),
        ),
        sealOneUnderKey: await codeOf(() =>
          ctx.fetch(`${SERVICE}/oauth.access`, {
            seal: { apiKey: { path: "$.access_token", key: "T1" } },
          }),
        ),
        keysOfOne: await codeOf(() => ctx.secrets.keys("apiKey")),
        forgetWithoutKey: await codeOf(() => ctx.secrets.forget("tokens")),
        sign: await codeOf(() => ctx.secrets.sign("tokens", "x", "hmac-sha256")),
      },
    })),
  },
};
