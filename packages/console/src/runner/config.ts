import * as z from "zod/mini";
import { isSecretName } from "../schemas.js";
import { hasForbiddenCodePoint } from "../text.js";

// `runner.json` (docs/specs/runner.md): in the desk, the working directory the runner is started
// in; written by setup, the agent's from then on. It names things and holds no secret. A file
// the agent wrote is read as any input is: by schema, bounded, and refused whole when it does
// not read.

/** A module's name, as a registry spells one. */
const moduleName = z.string().check(z.regex(/^[a-z][a-z0-9-]{0,39}$/));
/** The name of an environment variable. */
const variable = z.string().check(z.regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/));
/** A file under the desk's ignored `work/`: a name or a few folders deep, never out of it. */
const workFile = z.string().check(
  z.minLength(1),
  z.maxLength(200),
  z.regex(/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/),
  z.refine(
    (path) => !path.split("/").some((part) => part === "." || part === ".."),
    "stays in work/",
  ),
);
const secretName = z.string().check(z.refine(isSecretName, "is the name of a secret"));
/**
 * A channel of a messenger, by the id the messenger gives it, capital letters and digits as
 * `C0123ABCD`: never its name, which changes, and which would be listened to by nobody while
 * the file read as right.
 */
const channel = z
  .string()
  .check(
    z.regex(/^[A-Z0-9]{2,24}$/, "is a channel's id at the messenger, as C0123ABCD, never its name"),
  );
const MAX_ENTRIES = 50;
/**
 * An emoji of a status (ADR-0170), by its name between colons as a messenger spells one: never
 * the character itself, and nothing a messenger would read as words.
 */
const statusEmoji = z
  .string()
  .check(
    z.regex(/^:[a-z0-9_+-]{1,64}:$/, "is an emoji by its name between colons, as :hourglass:"),
  );
/** The words of a status: one line of plain words, within what a messenger shows of one. */
const statusText = (most: number) =>
  z
    .string()
    .check(
      z.refine(
        (text) =>
          text.length > 0 &&
          text.length <= most &&
          text.trim() === text &&
          !hasForbiddenCodePoint(text),
        `is one line of plain words, ${most} characters at the most`,
      ),
    );
/** The most a status says: what the messenger of the one source that shows one takes. */
const MAX_STATUS_TEXT = 100;
/**
 * What the words of the usage limit go on with where the moment is known: `{time}` stands for
 * it. Short enough that the two together, with the longest moment, stay within a status.
 */
const MAX_STATUS_LIMITED_TEXT = 60;
const MAX_STATUS_BACK = 24;
const statusBack = z
  .string()
  .check(
    z.refine(
      (text) =>
        text.length <= MAX_STATUS_BACK &&
        text.trim() === text &&
        !hasForbiddenCodePoint(text) &&
        text.split("{time}").length === 2,
      `is a few plain words with {time} in them once, ${MAX_STATUS_BACK} characters at the most`,
    ),
  );
/** The seconds a turn is given before the agent is shown as at work: where the desk says none, and the least and the most it may say. */
export const STATUS_AFTER = 30;
const MIN_STATUS_AFTER = 5;
const MAX_STATUS_AFTER = 600;
/** How a status is shown: its emoji and its words, each the source's own where left out. */
const statusLook = (most: number) =>
  z.optional(
    z.strictObject({ emoji: z.optional(statusEmoji), text: z.optional(statusText(most)) }),
  );
/**
 * The browsers a desk may name (ADR-0151): `headless`, a Google Chrome with no window and a
 * profile of its own, driven by a program the product is started with; `window`, the same
 * browser and profile with its window, for when someone is to see it; `chrome`, the product's
 * own browser tool, in the Chrome of the OS account with its window; and `none`, for an agent
 * that is to have no browser.
 */
export const RUNNER_BROWSERS = ["headless", "window", "chrome", "none"] as const;
export type RunnerBrowser = (typeof RUNNER_BROWSERS)[number];
const bounded = <T extends Record<string, string>>(entries: T): boolean =>
  Object.keys(entries).length <= MAX_ENTRIES;

export const runnerConfigSchema = z.object({
  /** The product's driver; `claude` where the file names none. */
  driver: z._default(moduleName, "claude"),
  /** The wake sources beside the console's own. */
  wake: z._default(z.array(moduleName).check(z.maxLength(10)), ["console"]),
  /** Whether the conversation goes on from one session to the next, or begins anew when the session is idle at the day's or the week's start. */
  conversation: z._default(z.enum(["continuous", "daily", "weekly"]), "continuous"),
  /** Which secrets of the account's store a session is handed: as environment variables, and as files of mode 600 under `work/`. */
  secrets: z._default(
    z.object({
      env: z._default(z.record(variable, secretName).check(z.refine(bounded, "too many")), {}),
      files: z._default(z.record(workFile, secretName).check(z.refine(bounded, "too many")), {}),
    }),
    { env: {}, files: {} },
  ),
  autosave: z._default(z.boolean(), true),
  /**
   * The product's command, where it is another than the driver's own, and the words it is
   * started with, for a driver that has none of its own: `acp`, whose product is whichever
   * program speaks the protocol.
   */
  product: z.optional(
    z.object({
      command: z.string().check(z.minLength(1), z.maxLength(400)),
      args: z._default(z.array(z.string().check(z.maxLength(400))).check(z.maxLength(40)), []),
    }),
  ),
  /**
   * The permission mode the product is started in, in the product's own word: what runs without
   * asking. Left out, the driver's own for a run nobody attends.
   */
  permissions: z.optional(z.string().check(z.regex(/^[A-Za-z][A-Za-z0-9-]{0,39}$/))),
  /**
   * The agent's browser, for a driver that starts its product with one (ADR-0140, ADR-0151): a
   * name of a short list, and never words for the product's command line. `headless` where the
   * file names none, a desk written before the name was there among them; `none` is said, and
   * never meant by saying nothing.
   */
  browser: z._default(z.enum(RUNNER_BROWSERS), "headless"),
  /**
   * The channels of a messenger the agent listens to, by their ids there: what a person says in
   * one wakes the agent through that messenger's wake source, named or not. Left out, a channel
   * wakes the agent only where it is named.
   */
  channels: z.optional(z.array(channel).check(z.maxLength(MAX_ENTRIES))),
  /**
   * How the agent stands to whoever waits for it, shown where a wake source has a place for it
   * (ADR-0170): that it is thinking over what was said to it there, that it has been at work
   * for longer than `after` seconds, and that the usage limit of its product stopped it, until
   * when. Each with an emoji and words of the desk's own, or the source's where it says none;
   * `false` shows nothing at all. Left out, as in a desk written before there was such a key
   * and in a config put together by hand, it is shown in the source's own way, and a turn is
   * given `STATUS_AFTER` seconds.
   */
  status: z.optional(
    z.union(
      [
        z.literal(false),
        z.strictObject({
          after: z.optional(
            z
              .int("is a whole number of seconds")
              .check(
                z.gte(MIN_STATUS_AFTER, `is ${MIN_STATUS_AFTER} seconds at the least`),
                z.lte(MAX_STATUS_AFTER, `is ${MAX_STATUS_AFTER} seconds at the most`),
              ),
          ),
          thinking: statusLook(MAX_STATUS_TEXT),
          working: statusLook(MAX_STATUS_TEXT),
          limited: z.optional(
            z.strictObject({
              emoji: z.optional(statusEmoji),
              text: z.optional(statusText(MAX_STATUS_LIMITED_TEXT)),
              back: z.optional(statusBack),
            }),
          ),
        }),
      ],
      "is false, or what is shown: after, thinking, working, limited",
    ),
  ),
});
export type RunnerConfig = z.infer<typeof runnerConfigSchema>;

/** What a runner runs with where there is no `runner.json`: the defaults, and no secret handed to a session. */
export const DEFAULT_RUNNER_CONFIG: RunnerConfig = runnerConfigSchema.parse({});

/** The most a `runner.json` is: it names a few things. */
const MAX_CONFIG_LENGTH = 64 * 1024;

/**
 * `runner.json` as its text says, or what is wrong with it in a few words. Nothing of a file
 * that does not read is used: a runner that guessed would hand a session the wrong secret.
 */
export function parseRunnerConfig(
  text: string,
):
  | { readonly ok: true; readonly config: RunnerConfig }
  | { readonly ok: false; readonly problem: string } {
  if (text.length > MAX_CONFIG_LENGTH) {
    return { ok: false, problem: "runner.json is larger than it may be" };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, problem: "runner.json is not readable JSON" };
  }
  const parsed = runnerConfigSchema.safeParse(json);
  if (!parsed.success) {
    const issue = nearest(parsed.error.issues[0]);
    const path = (issue?.path ?? []).map(String).join(".");
    return {
      ok: false,
      problem: `runner.json: ${path.length === 0 ? "" : `${path}: `}${issue?.message ?? "does not read"}`,
    };
  }
  return { ok: true, config: parsed.data };
}

/** What is wrong, as the schema says it, and where. */
interface Problem {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/**
 * The problem as said nearest to what is wrong. A value that may be one of several shapes is
 * refused as none of them, which names the key and not the word under it that does not read:
 * where one of the shapes was read further in before it failed, its own problem is the one said.
 */
function nearest(issue: z.core.$ZodIssue | undefined): Problem | undefined {
  if (issue === undefined || issue.code !== "invalid_union") {
    return issue;
  }
  const within = issue.errors
    .map((problems) => nearest(problems[0]))
    .filter((inner) => inner !== undefined && inner.path.length > 0)
    .sort((one, other) => (other?.path.length ?? 0) - (one?.path.length ?? 0))[0];
  return within === undefined
    ? issue
    : { path: [...issue.path, ...within.path], message: within.message };
}
