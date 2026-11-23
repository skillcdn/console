import { describe, expect, it } from "vitest";
import type { RestAgentSetup } from "./schemas.js";
import {
  BROWSER_OF_AN_AGENT,
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
    // The line has whoever is given it install what is missing without asking, and ask a
    // person for a sign-in alone (ADR-0140).
    expect(setupSentenceOf(COMMAND)).toBe(
      `Set this machine up for an agent account. Install what is missing yourself, without asking: first Node.js 24 or later and the command (npm i -g @skillcdn/console). Then run ${COMMAND} and do what it prints. Ask me only for a sign-in or an administrator's password.`,
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
      ["machine", "operator"],
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
      "Its product, signed in",
      "The one line",
    ]);
    // A person's part is what only a person does: the machine stays on, the product is signed
    // in, and everything else the session that is given the line installs.
    expect(before?.steps[3]?.body).toContain("On a machine that stays on and awake");
    expect(before?.steps[4]?.body).toContain(
      "Whatever else the machine needs, the session that is given the line installs itself.",
    );
    // What has to be there, and never who makes it or what a provider's terms ask (ADR-0094).
    expect(before?.steps[0]?.body).toContain(
      "The user `mira@acme.example` in the Workspace, with a mailbox, made if it is not there yet",
    );
    expect(before?.steps[0]?.body).toContain(
      "What it signs in with, its password and its second step, at hand when its machine is set up",
    );
    expect(setupGuideText(guide)).not.toMatch(/a person makes|person's to make|terms/i);
    expect(before?.steps[1]?.body).toContain("`acme-mira`");
    expect(before?.steps[4]?.line).toBeUndefined();
    expect(before?.steps[5]?.line).toBe(setupSentenceOf(COMMAND));
    // On the machine (ADR-0140): what is missing is installed first, a person signs in
    // themselves, and the machine's part ends when the agent's session has begun.
    expect(machine?.steps.map((step) => step.title)).toEqual([
      "What the machine needs",
      "The sign-in",
      "What the command does then",
      "Then stop",
    ]);
    expect(machine?.steps[0]?.body).toContain(
      "names everything that is missing at once: git, the product's command, the agent's browser and the program that drives it. Install each yourself, without asking",
    );
    // The person signs in themselves, at this console and as nobody else; no password is
    // written in a chat, and a secret is seeded from the person's own machine.
    expect(machine?.steps[1]?.body).toContain(
      '"Sign in there through Google as `mira@acme.example`, check that the page shows this code, and say that it is you."',
    );
    expect(machine?.steps[1]?.body).toContain("no password is written in a chat");
    expect(machine?.steps[1]?.body).toContain("`console agent secret mira <name>`");
    expect(machine?.steps[1]?.body).toContain("Nobody else's sign-in answers for the account");
    expect(setupGuideText(guide)).not.toMatch(/and I type it|give me what it signs in with/);
    expect(machine?.steps[2]?.body).toContain("It needs no administrator's rights");
    // What comes after is the agent's own, and the way to tell it what changed on the machine.
    expect(machine?.steps[3]?.body).toContain("Do none of it for it.");
    expect(machine?.steps[3]?.body).toContain('`console agent wake me "<what changed>"`');
    // How it signs in elsewhere, at a page: in the browser its runner starts it with, where a
    // sign-in stays, of the two it chooses between itself (ADR-0149); a person signing in
    // inside its session where it cannot; nothing in a message.
    expect(browser?.title).toBe("Signing in elsewhere, in a browser");
    expect(browser?.steps.map((step) => step.title)).toEqual([
      "Use the browser you are started with, and keep it",
      "Where a sign-in wants a person",
      "Keep what you sign in with",
    ]);
    expect(browser?.steps[0]?.body).toContain('the browser your runner.json names as "browser"');
    expect(browser?.steps[0]?.body).toContain(BROWSER_OF_AN_AGENT);
    expect(BROWSER_OF_AN_AGENT).toContain('"headless", which is yours where the file names none');
    expect(BROWSER_OF_AN_AGENT).toContain("the Claude in Chrome extension");
    expect(BROWSER_OF_AN_AGENT).toContain("Which of the two you use is yours to choose.");
    expect(browser?.steps[1]?.body).toContain("over a remote desktop");
    // What a sign-in is like sends the agent to neither browser.
    expect(browser?.steps.map((step) => step.body).join(" ")).not.toMatch(
      /ask for "chrome"|has none for/,
    );
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
      body.match(/The account `acme-mira` at GitHub, with the agent's own mailbox/g),
    ).toHaveLength(1);
    // A login at a git host goes to whoever registers it: the account it signs in with is the
    // organization's before the agent account is added, and the guide never says to make it later.
    expect(body).toContain(
      "It has to be the organization's own there already, from before the agent account was added here: that is when the console asks the host which account the login is, and a login nobody holds is whoever registers it first.",
    );
    expect(body).not.toContain("made if it is not there yet");
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
      body: "The account `carol` at GitHub. It has to be the organization's own there already, from before the agent account was added here: that is when the console asks the host which account the login is, and a login nobody holds is whoever registers it first. Where nobody holds it yet, register it before anything else. What it signs in with is at hand when the machine is set up: the setup signs in with it once, in the machine's browser.",
    });
    // A Workspace makes its own addresses: the account may be made on the way.
    const workspace = setupGuideOf(
      {
        ...SETUP,
        account: { ...SETUP.account, login: "carol@acme.example", host: "google" },
        workspace: { name: "Acme", handle: null, domain: null, services: {} },
      },
      CODE,
    );
    expect(workspace.sections[0]?.steps[0]?.body).toContain("made if it is not there yet");
    expect(workspace.sections[0]?.steps[0]?.body).not.toContain("whoever registers it first");
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
    expect(lines).toContain("## 2. On the machine (whoever prepares the machine)");
    // The command prints the part of whoever prepares the machine and no more (ADR-0140): what
    // the agent does when it starts is its first task, read by the agent in its own session.
    expect(text).not.toContain("When the agent starts");
    expect(text).not.toContain("Signing in elsewhere, in a browser");
    expect(text).not.toContain("What the agent asks for");
    expect(text).not.toContain("Make your desk there and push it");
    expect(lines).toContain(`      ${setupSentenceOf(COMMAND)}`);
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
