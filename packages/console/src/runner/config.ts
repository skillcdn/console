import * as z from "zod/mini";
import { isSecretName } from "../schemas.js";

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
const MAX_ENTRIES = 50;
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
    const issue = parsed.error.issues[0];
    const path = (issue?.path ?? []).map(String).join(".");
    return {
      ok: false,
      problem: `runner.json: ${path.length === 0 ? "" : `${path}: `}${issue?.message ?? "does not read"}`,
    };
  }
  return { ok: true, config: parsed.data };
}
