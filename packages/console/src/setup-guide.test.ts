import { describe, expect, it } from "vitest";
import type { RestAgentSetup } from "./schemas.js";
import {
  SETUP_INSTALL,
  setupCommandOf,
  setupGuideOf,
  setupGuideText,
  setupSentenceOf,
} from "./setup-guide.js";

// The guide an invitation's code opens (ADR-0088): made from what the code opens and nothing
// else, for the account and the services of its workspace, in the order a setup is done.

const SETUP: RestAgentSetup = {
  account: {
    handle: "mira",
    name: "Mira",
    title: "Release engineer",
    login: "mira@acme.example",
    host: "google",
    avatarParts: null,
  },
  workspace: {
    name: "Acme",
    handle: "acme",
    domain: "acme.example",
    services: {
      identity: { kind: "google-workspace" },
      git: { kind: "github", organization: "acme" },
      messenger: { kind: "slack", workspace: "acme.slack.com" },
    },
  },
  console: { url: "https://console.acme.example" },
  expiresAt: "2026-11-17T09:00:00.000Z",
};
const CODE = "ABCD-EFGH";
const COMMAND = "console agent setup --console https://console.acme.example --code ABCD-EFGH";

describe("the guide of an agent account's setup (ADR-0088)", () => {
  it("spells the command and the one line as they are said on the machine", () => {
    expect(setupCommandOf("https://console.acme.example", CODE)).toBe(COMMAND);
    expect(setupSentenceOf(COMMAND)).toBe(
      `Run: ${COMMAND} (before it: npm i -g @skillcdn/console), then do what it prints`,
    );
    expect(SETUP_INSTALL).toBe("npm i -g @skillcdn/console");
  });

  it("names the account, how it signs in, and what the code is", () => {
    const guide = setupGuideOf(SETUP, CODE);
    expect(guide.title).toBe("Setting up @mira (Mira, Release engineer)");
    expect(guide.about[0]).toContain("of Acme, whose console is at https://console.acme.example");
    expect(guide.about[0]).toContain("signs in there as `mira@acme.example` through Google");
    expect(guide.about[1]).toContain("an invitation and no credential");
    expect(guide.expiresAt).toBe(SETUP.expiresAt);
    // An account with a handle alone is called by it.
    const bare = setupGuideOf(
      { ...SETUP, account: { ...SETUP.account, name: null, title: null } },
      CODE,
    );
    expect(bare.title).toBe("Setting up @mira");
  });

  it("says each part in its order, and whose it is", () => {
    const guide = setupGuideOf(SETUP, CODE);
    expect(guide.sections.map((section) => [section.key, section.who])).toEqual([
      ["before", "operator"],
      ["machine", "agent"],
      ["start", "agent"],
      ["asked", "manager"],
    ]);
    const [before, machine, start, asked] = guide.sections;
    // Before the line: the services in the words of their modules, with the names put together
    // for this account, then the machine, the product and the line itself.
    expect(before?.steps.map((step) => step.title)).toEqual([
      "Google Workspace, where the account signs in",
      "GitHub, the git host",
      "Slack, the messenger",
      "An OS account of its own",
      "Its product and the command",
      "The one line",
    ]);
    expect(before?.steps[0]?.body).toContain("makes the user `mira@acme.example`");
    expect(before?.steps[1]?.body).toContain("`acme-mira`");
    expect(before?.steps[4]?.line).toBe(SETUP_INSTALL);
    expect(before?.steps[5]?.line).toBe(setupSentenceOf(COMMAND));
    // On the machine: the account's own sign-in, at this console, and nobody else's.
    expect(machine?.steps[0]?.line).toBe("console login --url https://console.acme.example --self");
    expect(machine?.steps[0]?.body).toContain("sign in through Google as `mira@acme.example`");
    expect(machine?.steps[0]?.body).toContain("nobody else's sign-in answers for the account");
    expect(machine?.steps[1]?.line).toBe("console whoami");
    // What the agent does itself, and what is asked of a person.
    expect(start?.steps.map((step) => step.title)).toContain("Make your desk there and push it");
    expect(asked?.steps.map((step) => step.title)).toEqual([
      "Make the account `acme-mira` at GitHub",
      "Invite mira to the messenger",
    ]);
  });

  it("says a service once that has two roles with one account", () => {
    const guide = setupGuideOf(
      {
        ...SETUP,
        account: { ...SETUP.account, login: "acme-mira", host: "gh" },
        workspace: {
          ...SETUP.workspace,
          services: { identity: { kind: "github" }, git: { kind: "github", organization: "acme" } },
        },
      },
      CODE,
    );
    const [before, , start, asked] = guide.sections;
    expect(before?.steps[0]?.title).toBe("GitHub, where the account signs in and the git host");
    // What either role says, each sentence once.
    const body = before?.steps[0]?.body ?? "";
    expect(body.match(/A person makes the account `acme-mira` at GitHub/g)).toHaveLength(1);
    expect(body).toContain("Its first password goes to whoever prepares the agent's machine");
    expect(body).toContain("An owner of the organization `acme` invites `acme-mira`");
    expect(before?.steps[1]?.title).toBe("An OS account of its own");
    expect(start?.steps.map((step) => step.title)).toEqual([
      "Sign in at the git host and keep what you sign in with",
      "Make your desk there and push it",
    ]);
    // Of two asks with one title, the fuller stands.
    expect(asked?.steps).toHaveLength(1);
    expect(asked?.steps[0]?.title).toBe("Make the account `acme-mira` at GitHub");
    expect(asked?.steps[0]?.body).toContain("invite it to `acme`");
    // An account spelled otherwise for one of the roles is another account, said apart.
    const apart = setupGuideOf(
      {
        ...SETUP,
        workspace: {
          ...SETUP.workspace,
          services: {
            identity: { kind: "github", account: "{agent}-at-{workspace}" },
            git: { kind: "github" },
          },
        },
      },
      CODE,
    );
    expect(apart.sections[0]?.steps.slice(0, 2).map((step) => step.title)).toEqual([
      "GitHub, where the account signs in",
      "GitHub, the git host",
    ]);
  });

  it("says the least of a workspace that names no service", () => {
    const guide = setupGuideOf(
      {
        ...SETUP,
        account: { ...SETUP.account, login: "carol", host: "gh" },
        workspace: { name: "Acme", handle: null, domain: null, services: {} },
      },
      CODE,
    );
    expect(guide.sections.map((section) => section.key)).toEqual(["before", "machine"]);
    expect(guide.sections[0]?.steps[0]).toEqual({
      title: "GitHub, where the account signs in",
      body: "Make the account `carol` at GitHub, as a person's is made there. Its first password goes to whoever prepares the agent's machine, and to nobody else.",
    });
    // A kind the package does not know is still named.
    const other = setupGuideOf(
      { ...SETUP, workspace: { ...SETUP.workspace, services: { git: { kind: "forge" } } } },
      CODE,
    );
    expect(other.sections[0]?.steps.map((step) => step.title)).toContain("forge, the git host");
  });

  it("prints as the command prints it, every line to run on a line of its own", () => {
    const text = setupGuideText(setupGuideOf(SETUP, CODE), (iso) => `<${iso}>`);
    const lines = text.split("\n");
    expect(lines[0]).toBe("# Setting up @mira (Mira, Release engineer)");
    expect(text).toContain("The invitation is good until <2026-11-17T09:00:00.000Z>.");
    expect(lines).toContain("## 1. Before the line (whoever prepares the machine)");
    expect(lines).toContain("## 2. On the machine (the agent)");
    expect(lines).toContain("## 3. When the agent starts (the agent)");
    expect(lines).toContain("## 4. What is asked of a person (its manager)");
    expect(lines).toContain(`      ${setupSentenceOf(COMMAND)}`);
    expect(lines).toContain("      console login --url https://console.acme.example --self");
    expect(text.endsWith("\n")).toBe(false);
    // As the API gives the day, where nothing says how to print a moment.
    expect(setupGuideText(setupGuideOf(SETUP, CODE))).toContain(
      "good until 2026-11-17T09:00:00.000Z.",
    );
  });

  it("carries what the account is called as words, whatever they hold", () => {
    const hostile = setupGuideOf(
      {
        ...SETUP,
        account: {
          ...SETUP.account,
          name: '<script>alert("x")</script>',
          title: "`rm -rf /` $(whoami)",
        },
      },
      CODE,
    );
    // Words in a title, and never a line to run: the lines are the guide's own.
    expect(hostile.title).toContain('<script>alert("x")</script>');
    const lines = hostile.sections.flatMap((section) =>
      section.steps.flatMap((step) => (step.line === undefined ? [] : [step.line])),
    );
    expect(lines.join("\n")).not.toContain("rm -rf");
    expect(lines.join("\n")).not.toContain("script");
  });
});
