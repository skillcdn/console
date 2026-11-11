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
    // Where it signs in at a page, it is told how a sign-in stays and what to do where one
    // wants a person, with nothing it signs in with in a message.
    expect(own).toContain(
      "- **Sign in at a page in the machine's own browser.** Use a browser tool of your product that attaches to the ordinary browser of your OS account",
    );
    expect(own).toContain("ask for a person to sign in inside your session");
    expect(own).toContain(
      "- **Make the account your own.** Sign in as `mira@acme.example`, change the first password",
    );
    expect(own).toContain(
      "- **Make your desk there and push it.** Make the repository `acme-mira/desk`",
    );
    expect(own).toContain("- **Join the messenger and say who you are.**");
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
        "- **An invitation for mira to the messenger.** Where none has reached your address",
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
      expect.stringContaining("Sign in at a page in the machine's own browser"),
      expect.stringContaining("Put your picture on your profiles"),
      expect.stringContaining("Record the accounts you hold elsewhere"),
      expect.stringContaining("Introduce yourself to your manager"),
    ]);
    expect(body).not.toContain("## What you ask for");
  });
});
