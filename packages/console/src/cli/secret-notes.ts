// What the command says of a secret's value as it is kept (ADR-0140): a value that does not look
// like what its name says is kept all the same, since the console knows no service's tokens for
// sure, and said so at once, where whoever keeps it can still put it right. A token copied half,
// or another value pasted in its place, is otherwise found out when a push fails. Nothing of the
// value is said: what a note names is its shape.

/** What a secret's name says of its value's shape, for the names the package itself reads or has an agent keep. */
const SHAPES: readonly {
  readonly name: string;
  /** The kind of git host the shape holds for, where it is one host's own. */
  readonly host?: string;
  readonly shape: RegExp;
  readonly says: string;
}[] = [
  {
    name: "slack.app_token",
    shape: /^xapp-/,
    says: "an app-level token of Slack begins with xapp-",
  },
  {
    // The same app's other token, which the agent sends with itself. The two are copied unseen,
    // one after the other, and the package never reads this one: nothing else here would say
    // that the wrong one was kept.
    name: "slack.user_token",
    shape: /^xoxp-/,
    says: "a member's token of Slack begins with xoxp-",
  },
  {
    name: "git.token",
    host: "github",
    shape: /^(gh[pousr]_|github_pat_)/,
    says: "a token of GitHub begins with ghp_ or github_pat_",
  },
  {
    name: "git.token",
    host: "gitlab",
    shape: /^gl[a-z]{2,6}-/,
    says: "a token of GitLab begins with glpat- or the like",
  },
];

/**
 * What to say of a value kept under a name, a line each, or nothing: that it holds a space or a
 * line break, which a token copied from a page seldom does on purpose, and that it is not of
 * the shape its name says. `gitHost` is the kind of git host the workspace names, where it
 * names one.
 */
export function secretNotes(
  name: string,
  value: string,
  gitHost?: string | undefined,
): readonly string[] {
  const notes: string[] = [];
  // A token by its name. A key is not asked this: one of several lines is a key all the same.
  const token = /(?:^|[._])token$/.test(name);
  if (token && /\s/.test(value)) {
    notes.push(
      "The value holds a space or a line break, which a token does not: check that it was copied whole and alone.",
    );
  }
  for (const one of SHAPES) {
    if (one.name === name && (one.host === undefined || one.host === gitHost)) {
      if (!one.shape.test(value.trim())) {
        notes.push(
          `The value does not look like what ${name} holds: ${one.says}. It is kept as it is; set it again if another value was pasted.`,
        );
      }
    }
  }
  return notes;
}
