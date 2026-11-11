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
      ["browser", "agent"],
      ["asked", "manager"],
    ]);
    const [before, machine, start, browser, asked] = guide.sections;
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
    // What has to be there, and never who makes it or what a provider's terms ask (ADR-0094).
    expect(before?.steps[0]?.body).toContain(
      "The user `mira@acme.example` in the Workspace, with a mailbox, made if it is not there yet",
    );
    expect(before?.steps[0]?.body).toContain(
      "What it signs in with, its password and its second step, at hand when its machine is set up",
    );
    expect(setupGuideText(guide)).not.toMatch(/a person makes|person's to make|terms/i);
    expect(before?.steps[1]?.body).toContain("`acme-mira`");
    expect(before?.steps[4]?.line).toBe(SETUP_INSTALL);
    expect(before?.steps[5]?.line).toBe(setupSentenceOf(COMMAND));
    // On the machine: the account's own sign-in, at this console, and nobody else's.
    expect(machine?.steps.map((step) => step.title)).toEqual([
      "Ask for the sign-in before you go on",
      "The command asks to be signed in as the account",
      "It makes the machine the agent's",
      "Check who the command is",
      "When the services or the account change",
    ]);
    // First the agent asks the person at the machine for what the sign-in takes, in words it
    // can say as they are: the exact account, that it be made where it is not there, and that
    // the person signs in or hands over what it signs in with.
    expect(machine?.steps[0]?.body).toContain(
      '"I am setting this machine up as @mira. The console signs me in as `mira@acme.example` through Google. Is that account there?',
    );
    expect(machine?.steps[0]?.body).toContain(
      "sign in as that account yourself, or give me what it signs in with, and I type it.",
    );
    expect(machine?.steps[0]?.body).toContain("Never sign in as anyone else");
    expect(machine?.steps[1]?.body).toContain(
      "sign in there through Google as `mira@acme.example`",
    );
    expect(machine?.steps[1]?.body).toContain("nobody else's sign-in answers for the account");
    expect(machine?.steps[1]?.line).toBeUndefined();
    expect(machine?.steps[2]?.body).toContain("It needs no administrator's rights");
    expect(machine?.steps[3]?.line).toBe("console whoami");
    expect(machine?.steps[4]?.line).toBe("console agent setup --refresh");
    // How it signs in elsewhere, at a page: in the machine's own browser, where a sign-in
    // stays; a person signing in inside its session where it cannot; nothing in a message.
    expect(browser?.title).toBe("Signing in elsewhere, in a browser");
    expect(browser?.steps.map((step) => step.title)).toEqual([
      "Use the machine's own browser, and keep it",
      "Where a sign-in wants a person",
      "Keep what you sign in with",
    ]);
    expect(browser?.steps[0]?.body).toContain("a browser tool of your product that attaches");
    expect(browser?.steps[1]?.body).toContain("over a remote desktop");
    expect(browser?.steps[1]?.body).toContain(
      "Nothing you sign in with is sent in a message, a task or a comment.",
    );
    // What the agent does itself, and what is asked of a person.
    expect(start?.steps.map((step) => step.title)).toContain("Make your desk there and push it");
    expect(asked?.title).toBe("What the agent asks for");
    expect(asked?.steps.map((step) => step.title)).toEqual([
      "The account `acme-mira` at GitHub",
      "An invitation for mira to the messenger",
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
    const [before, , start] = guide.sections;
    const asked = guide.sections.find((section) => section.key === "asked");
    expect(before?.steps[0]?.title).toBe("GitHub, where the account signs in and the git host");
    // What either role says, each sentence once.
    const body = before?.steps[0]?.body ?? "";
    expect(
      body.match(/The account `acme-mira` at GitHub, made if it is not there yet/g),
    ).toHaveLength(1);
    expect(body).toContain("What it signs in with, its password and its second step, at hand");
    expect(body).toContain("Its invitation to the organization `acme`");
    expect(before?.steps[1]?.title).toBe("An OS account of its own");
    expect(start?.steps.map((step) => step.title)).toEqual([
      "Sign in at the git host and keep what you sign in with",
      "Make your desk there and push it",
    ]);
    // Nothing is asked for later at the service the account signs in through: that account
    // came before the line.
    expect(asked).toBeUndefined();
    expect(guide.sections.map((section) => section.key)).toEqual([
      "before",
      "machine",
      "start",
      "browser",
    ]);
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
    expect(guide.sections.map((section) => section.key)).toEqual(["before", "machine", "browser"]);
    expect(guide.sections[0]?.steps[0]).toEqual({
      title: "GitHub, where the account signs in",
      body: "The account `carol` at GitHub, made if it is not there yet, and what it signs in with at hand when the machine is set up: the setup signs in with it once, in the machine's browser.",
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
    expect(lines).toContain("## 4. Signing in elsewhere, in a browser (the agent)");
    expect(lines).toContain("## 5. What the agent asks for (its manager)");
    expect(lines).toContain(`      ${setupSentenceOf(COMMAND)}`);
    expect(lines).toContain("      console agent setup --refresh");
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
