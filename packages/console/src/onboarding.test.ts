import { describe, expect, it } from "vitest";
import { onboardingOf, onboardingTitle } from "./onboarding.js";

// The onboarding task of an agent account (ADR-0088): its words, made for one account and the
// services of its workspace.

const WORKSPACE = {
  handle: "acme",
  domain: "acme.example",
  services: {
    identity: { kind: "google-workspace" },
    git: { kind: "github", organization: "acme" },
    messenger: { kind: "slack", workspace: "acme.slack.com" },
  },
};

describe("the onboarding task of an agent account", () => {
  it("is called after the account", () => {
    expect(onboardingTitle("mira")).toBe("Set up @mira");
    expect(onboardingOf({ handle: "mira", workspace: WORKSPACE }).title).toBe("Set up @mira");
  });

  it("says what the agent does itself, in the words of the services, then what is its own everywhere", () => {
    const { body } = onboardingOf({ handle: "mira", workspace: WORKSPACE });
    const own = body.slice(
      body.indexOf("## What you do yourself"),
      body.indexOf("## What you ask for"),
    );
    expect(own.split("\n").filter((line) => line.startsWith("- **"))).toHaveLength(9);
    // Where it signs in at a page, it is told how a sign-in stays, with nothing it signs in with
    // in a message; no sign-in is set aside for a person: it asks for help where it cannot go on.
    expect(own).toContain(
      '- **Sign in at a page in the browser you are started with.** Use the browser your runner.json names as "browser": it keeps a profile, so a sign-in stays there from one session to the next.',
    );
    expect(own).not.toContain("ask for a person to sign in");
    expect(own).toContain(
      "- **Make the account your own.** Sign in as `mira@acme.example`, change the first password",
    );
    expect(own).toContain(
      "- **Make your desk there and push it.** Make the repository `acme-mira/desk`",
    );
    // Its profile carries its name and its role, as any member's does, and no word of what it is
    // (ADR-0143).
    expect(own).toContain(
      "- **Join the messenger and set your profile.** Accept the invitation to `acme.slack.com` that came to `mira@acme.example`, the address you sign in with, and set your name, your title and your picture as any member does",
    );
    expect(own).not.toMatch(/you are an agent|AI agent|not a person/i);
    // The browsers a runner.json names, said where the agent is told to sign in at a page: the
    // one with no window, which it has where the file names none, and the product's own tool
    // (ADR-0151). Which of them it uses is its own to choose: the task says what each is, and
    // sends it to neither.
    expect(own).toContain(
      '"headless", which is yours where the file names none, is a Google Chrome with no window and a profile of its own, driven with the tools of the server chrome-devtools',
    );
    expect(own).toContain(
      '"chrome" is, for Claude Code, its own browser tool in the Google Chrome of your OS account, which takes the Claude in Chrome extension there',
    );
    expect(own).toContain("Which of the two you use is yours to choose.");
    expect(own).not.toMatch(/ask for "chrome"|has none for/);
    // The wake source is taken by the runner by itself, and where to see that it is.
    expect(own).toContain(
      'add "slack" to "wake" in runner.json. The runner takes the change by itself once your turn is over: console agent <handle> then says the source is connected.',
    );
    expect(own).toContain(
      "- **Put your picture on your profiles.** `console agent mira --avatar avatar.png` writes it as a file.",
    );
    expect(own).toContain(
      "- **Record the accounts you hold elsewhere.** For each service you now have an account at, say what you are called there, and never a secret: `console agent mira --account <service>=<name>`",
    );
    expect(own).toContain(
      "- **Introduce yourself to your manager.** `console manager` says who it is.",
    );
    expect(
      body.startsWith("This is your first task, @mira: making your account ready to work."),
    ).toBe(true);
    expect(body.endsWith("finish the task.\n")).toBe(true);
  });

  it("says what it cannot do itself as decisions to ask, with how a secret is handed back", () => {
    const { body } = onboardingOf({ handle: "mira", workspace: WORKSPACE });
    const asked = body.slice(
      body.indexOf("## What you ask for"),
      body.indexOf("## When you are done"),
    );
    // Who makes an account at a service, and what a service's terms ask, is the organization's
    // to say: the task says neither (ADR-0094).
    expect(body).not.toMatch(/only a person|a person makes|terms/i);
    expect(asked).toContain('`console ask "<question>" --option "Done" --option "Not now"`');
    expect(asked).toContain("`console agent secret mira <name>`");
    expect(asked).toContain("of your manager where you do not know who");
    expect(asked.split("\n").filter((line) => line.startsWith("- **"))).toEqual([
      expect.stringContaining(
        "- **The account `acme-mira` at GitHub.** Where you cannot sign in at GitHub as `acme-mira`: that the account is made",
      ),
      expect.stringContaining(
        "- **An invitation for mira to the messenger.** Where none has come to `mira@acme.example`, the address you sign in with",
      ),
    ]);
  });

  it("asks nothing of a person at the service the account signs in through, which came before the line", () => {
    const { body } = onboardingOf({
      handle: "mira",
      workspace: {
        handle: "acme",
        domain: null,
        services: { identity: { kind: "github" }, git: { kind: "github", organization: "acme" } },
      },
    });
    expect(body).not.toContain("## What you ask for");
    expect(body).not.toContain("The account `acme-mira` at GitHub");
    // What the agent does there itself stays: its token for git, and its desk.
    expect(body).toContain("- **Sign in at the git host and keep what you sign in with.**");
    expect(body).toContain("- **Make your desk there and push it.**");
  });

  it("says the least of a workspace that names no service", () => {
    const { body } = onboardingOf({
      handle: "mira",
      workspace: { handle: null, domain: null, services: {} },
    });
    expect(body.split("\n").filter((line) => line.startsWith("- **"))).toEqual([
      expect.stringContaining("Sign in at a page in the browser you are started with"),
      expect.stringContaining("Put your picture on your profiles"),
      expect.stringContaining("Record the accounts you hold elsewhere"),
      expect.stringContaining("Introduce yourself to your manager"),
    ]);
    expect(body).not.toContain("## What you ask for");
  });

  it("keeps the run open while anything of the task waits on a person, and is done when nothing does", () => {
    const { body } = onboardingOf({ handle: "mira", workspace: WORKSPACE });
    // A run that waits for a decision is never ended by the console, and a finished run asks
    // nothing more: the task is not finished around what it asked.
    expect(body).toContain(
      "What waits on a person you ask for as a decision, and a run that waits for a decision stays open: the answer wakes you, and you go on with that run (`--run <id>`). The task is finished when nothing of it waits on anyone.",
    );
    expect(body.slice(body.indexOf("## When you are done"))).toBe(
      [
        "## When you are done",
        "",
        "When nothing of this task waits on anyone, every item set up or answered as not to be done now, report what is set up and, item by item, what is not done and who said so, and finish the task.",
        "",
      ].join("\n"),
    );
    expect(body).not.toContain("what still waits on a person");
  });

  it("names the account's own address where it signs in with one, and has it ask for one where it does not", () => {
    // At a Workspace the account signs in with an address, which is its address everywhere.
    const named = onboardingOf({ handle: "mira", workspace: WORKSPACE }).body;
    expect(named).toContain(
      "Accept the invitation to `acme.slack.com` that came to `mira@acme.example`, the address you sign in with, and set your name",
    );
    expect(named).toContain(
      "Where none has come to `mira@acme.example`, the address you sign in with: an invitation to `acme.slack.com` as a member, sent there",
    );
    // The login the account was made with is the one that counts, where it is known.
    const given = onboardingOf({
      handle: "mira",
      workspace: WORKSPACE,
      login: "release-bot@acme.example",
    }).body;
    expect(given).toContain("that came to `release-bot@acme.example`");
    expect(given).not.toContain("that came to `mira@acme.example`");
    // A login at a git host is no address: the task has it ask which address, and offer none.
    const gitHost = {
      handle: "acme",
      domain: "acme.example",
      services: {
        identity: { kind: "github" },
        git: { kind: "github", organization: "acme" },
        messenger: { kind: "slack", workspace: "acme.slack.com" },
      },
    };
    for (const asked of [
      onboardingOf({ handle: "mira", workspace: gitHost }).body,
      onboardingOf({ handle: "mira", workspace: WORKSPACE, login: "acme-mira" }).body,
    ]) {
      expect(asked).toContain(
        "Where you hold none: ask which address an invitation to `acme.slack.com` is to be sent to, and name none yourself, since an address put together from your names is nobody's.",
      );
      expect(asked).toContain(
        "Accept the invitation to `acme.slack.com` where one has reached you",
      );
      expect(asked).not.toContain("mira@acme.example`, the address");
      expect(asked).not.toMatch(/your (own )?address/);
    }
  });

  it("names the organization's pack where the desk is made, for the skill that sets one up", () => {
    const { body } = onboardingOf({ handle: "mira", workspace: WORKSPACE });
    expect(body).toContain(
      "- **Make your desk there and push it.** Make the repository `acme-mira/desk`, private, and push the desk to it. The desk's git takes git.token from your store by itself, so nothing is typed and no helper of the machine keeps a copy. Where the organization's pack has a skill for setting a desk up, go by it: console skills --search \"desk setup\" --limit 5.",
    );
  });
});
