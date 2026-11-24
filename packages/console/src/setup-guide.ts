import { en } from "./i18n/en.js";
import type { RestAgentSetup, RestWorkspace } from "./schemas.js";
import {
  agentAddressOf,
  describeService,
  HELD_BEFORE_ADDED,
  type ServiceItem,
  serviceNamesOf,
} from "./services.js";
import { type ProviderKey, SERVICE_ROLES, type ServiceRole } from "./vocabulary.js";

// The guide an invitation's code opens (ADR-0088): what setting a machine up for one agent
// account takes, written for that account and the services of its workspace, in the order it is
// done and by whom. `/setup/<code>` shows it whole to a person; `console agent setup --code`
// prints the part of whoever prepares the machine, a person or the session that was given the
// line, and no more (ADR-0140): the machine is given its least there, and everything after is
// the agent's own, in its own session. It is written in English, as a skill is, for an agent to
// read as it is, and says nothing secret.

/** How the console's command gets onto a machine. */
export const SETUP_INSTALL = "npm i -g @skillcdn/console";

/** The command that sets a machine up for the account a code is the invitation of. */
export function setupCommandOf(origin: string, code: string): string {
  return `console agent setup --console ${origin} --code ${code}`;
}

/**
 * The sentence said to the agent's product on its machine. It carries the command as written,
 * so that the product runs it and reads the guide from the command's own words. In English, as
 * the guide is and as the command prints it; a page says it in the language of whoever reads
 * it, from their pack, where this one is the English pack's.
 */
export function setupSentenceOf(command: string): string {
  return en.agents.page.settings.machine.made.line(command, SETUP_INSTALL);
}

/**
 * The browsers an agent's `runner.json` names (ADR-0151), as the agent is told of them where it
 * is told to sign in at pages: what each is, and that which of them it uses is its own to
 * choose. The setup looks for the one asked for on the machine.
 */
export const BROWSER_OF_AN_AGENT =
  '"headless", which is yours where the file names none, is a Google Chrome with no window and a profile of its own, driven with the tools of the server chrome-devtools: nothing is installed in it and nothing signed in for it. "chrome" is, for Claude Code, its own browser tool in the Google Chrome of your OS account, which takes the Claude in Chrome extension there, signed in with your subscription. Which of the two you use is yours to choose.';

/** Whose part of a setup something is (ADR-0088): whoever prepares the machine, the agent, its manager. */
export type SetupRole = "operator" | "agent" | "manager";

export interface SetupGuideStep {
  /** What the step is about. */
  readonly title: string;
  readonly body: string;
  /** What to run or to say, as written, where the step has such a line. */
  readonly line?: string;
}

export interface SetupGuideSection {
  readonly key: "before" | "machine" | "start" | "browser" | "asked";
  readonly who: SetupRole;
  readonly title: string;
  readonly about: string;
  readonly steps: readonly SetupGuideStep[];
}

export interface SetupGuide {
  readonly title: string;
  /** What the guide is and what the code is, a paragraph each. */
  readonly about: readonly string[];
  /** When the invitation ends, unless the account's command has signed in before. */
  readonly expiresAt: string;
  readonly sections: readonly SetupGuideSection[];
}

const SIGNS_IN_AT: Readonly<Record<ProviderKey, string>> = { gh: "GitHub", google: "Google" };

const ROLE_WORDS: Readonly<Record<ServiceRole, string>> = {
  identity: "where the account signs in",
  git: "the git host",
  messenger: "the messenger",
};

/** A service of the workspace as the guide says it: once, whatever roles it has. */
export interface GuideService {
  readonly kind: string;
  readonly name: string;
  readonly account: string | undefined;
  readonly roles: ServiceRole[];
  guide: readonly string[];
  onboarding: readonly ServiceItem[];
  asks: readonly ServiceItem[];
}

/** Items said once: of two with one title, the fuller stands, since it says what the other does and more. */
function itemsOnce(items: readonly ServiceItem[], more: readonly ServiceItem[]): ServiceItem[] {
  const once = [...items];
  for (const item of more) {
    const at = once.findIndex((other) => other.title === item.title);
    if (at === -1) {
      once.push(item);
    } else if (item.body.length > (once[at]?.body.length ?? 0)) {
      once[at] = item;
    }
  }
  return once;
}

/**
 * The services a workspace names, each with what its module says of it for one account. A
 * service that has two roles with one account there, a git host people also sign in through, is
 * said once, with what either role adds. Nothing is asked of a person later at the service the
 * account signs in through: that account comes before the line, since the agent signs in with
 * it, and so does whatever a person does of it there.
 */
export function guideServicesOf(
  workspace: Pick<RestWorkspace, "handle" | "domain" | "services">,
  handle: string,
  /** The login the account signs in with, where it is known: an address there is its own address. */
  login?: string,
): GuideService[] {
  const names = serviceNamesOf(workspace, handle);
  const address = agentAddressOf(workspace, handle, login);
  const services: GuideService[] = [];
  for (const role of SERVICE_ROLES) {
    const service = workspace.services?.[role];
    if (service === undefined) {
      continue;
    }
    const said = describeService(role, service, names, address);
    const same = services.find(
      (other) => other.kind === said.provider.kind && other.account === said.account,
    );
    if (same === undefined) {
      services.push({
        kind: said.provider.kind,
        name: said.provider.name,
        account: said.account,
        roles: [role],
        guide: said.guide,
        onboarding: said.onboarding,
        asks: said.asks,
      });
      continue;
    }
    same.roles.push(role);
    same.guide = [...same.guide, ...said.guide.filter((line) => !same.guide.includes(line))];
    same.onboarding = itemsOnce(same.onboarding, said.onboarding);
    same.asks = itemsOnce(same.asks, said.asks);
  }
  for (const service of services) {
    if (service.roles.includes("identity")) {
      service.asks = [];
    }
  }
  return services;
}

/** The guide of one setup: the account it is for, the services of its workspace, and the code that opened it. */
export function setupGuideOf(setup: RestAgentSetup, code: string): SetupGuide {
  const { account, workspace } = setup;
  const provider = SIGNS_IN_AT[account.host];
  const command = setupCommandOf(setup.console.url, code);
  const called =
    account.name === null || account.name.length === 0
      ? `@${account.handle}`
      : `@${account.handle} (${[account.name, account.title].filter((part) => part !== null && part.length > 0).join(", ")})`;
  const described = guideServicesOf(workspace, account.handle, account.login);
  const serviceTitle = (one: GuideService): string =>
    `${one.name}, ${one.roles.map((role) => ROLE_WORDS[role]).join(" and ")}`;

  const before: SetupGuideStep[] = [
    ...described
      .filter((one) => one.guide.length > 0)
      .map((one) => ({ title: serviceTitle(one), body: one.guide.join(" ") })),
    ...(workspace.services.identity === undefined
      ? [
          {
            title: `${provider}, where the account signs in`,
            // A git host gives a login to whoever registers it; a Workspace makes its own.
            body:
              account.host === "gh"
                ? `The account \`${account.login}\` at ${provider}. ${HELD_BEFORE_ADDED} What it signs in with is at hand when the machine is set up: the setup signs in with it once, in the machine's browser.`
                : `The account \`${account.login}\` at ${provider}, made if it is not there yet, and what it signs in with at hand when the machine is set up: the setup signs in with it once, in the machine's browser.`,
          },
        ]
      : []),
    {
      title: "An OS account of its own",
      body: "On a machine that stays on and awake, an OS account for the agent, apart from anyone else's. Whether it holds an administrator's rights is for whoever keeps the machine to say.",
    },
    {
      title: "Its product, signed in",
      body: "In that OS account, the agent's product (Claude Code, Codex or another), signed in with the agent's own subscription. Whatever else the machine needs, the session that is given the line installs itself.",
    },
    {
      title: "The one line",
      body: "Open a session of the product there and say this to it. You act as yourself in the console, and never sign in to it on the agent's machine.",
      line: setupSentenceOf(command),
    },
  ];

  const machine: SetupGuideStep[] = [
    {
      title: "What the machine needs",
      body: "The command looks at the machine first and names everything that is missing at once: git, the product's command, the agent's browser and the program that drives it. Install each yourself, without asking, and run the line again.",
    },
    {
      title: "The sign-in",
      body: `Then the command opens an address in the machine's browser, prints it with a code, and waits. Say to the person at the machine: "Sign in there through ${provider} as \`${account.login}\`, check that the page shows this code, and say that it is you." They sign in themselves, and no password is written in a chat: a secret the agent is to hold, they seed from their own machine (\`console agent secret ${account.handle} <name>\`). Nobody else's sign-in answers for the account; where the page shows another member, they sign out there first.`,
    },
    {
      title: "What the command does then",
      body: "It writes the desk in the OS account's home from the template, or clones it where the account pushed one before, writes the service that keeps the runner running, starts it, and waits until the agent's first session has begun. It needs no administrator's rights, and writes over no file of a desk that is there.",
    },
    {
      title: "Then stop",
      body: `That is the machine prepared. What comes after is the agent's own, done in its own session from its first task: its sign-ins at the services, its tokens, its desk's repository, its profile, its messenger. Do none of it for it. What you change on this machine afterwards, say to it: \`console agent wake me "<what changed>"\`.`,
    },
  ];

  const start: SetupGuideStep[] = described.flatMap((one) =>
    one.onboarding.map((item) => ({ title: item.title, body: item.body })),
  );
  // How the agent signs in at the services it works with, said once for all of them: a sign-in
  // is the agent's own, kept in the browser its runner starts it with, and nothing it signs in
  // with is sent in a message. No sign-in is set aside for a person: a headless browser has no
  // window for one, and the agent asks for help where it cannot go on, as with anything else.
  const browser: SetupGuideStep[] = [
    {
      title: "Use the browser you are started with, and keep it",
      body: `Sign in at a service in the browser your runner.json names as "browser". It keeps a profile, so a sign-in stays there from one session to the next, as a person's does. A browser a tool starts anew each time, with no profile kept, keeps none, and a service takes it for a stranger each time and asks again. ${BROWSER_OF_AN_AGENT}`,
    },
    {
      title: "Keep what you sign in with",
      body: "Nothing you sign in with is sent in a message, a task or a comment. A password you chose or were handed goes into your store, with the day it ends where it has one: `console secret <service>.password --set --expires <day>`. Turn on a second step you can answer yourself where the service has one.",
    },
  ];
  const asked: SetupGuideStep[] = described.flatMap((one) =>
    one.asks.map((item) => ({ title: item.title, body: item.body })),
  );

  const sections: SetupGuideSection[] = [
    {
      key: "before",
      who: "operator",
      title: "Before the line",
      about: "For the person who has the machine prepared: what only a person does.",
      steps: before,
    },
    {
      key: "machine",
      who: "operator",
      title: "On the machine",
      about:
        "For the session that was given the line, or whoever runs the command in the agent's OS account. The account is entered through its own sign-in and through nothing else.",
      steps: machine,
    },
    ...(start.length === 0
      ? []
      : [
          {
            key: "start" as const,
            who: "agent" as const,
            title: "When the agent starts",
            about:
              "What the agent does itself, in its own session, as its first task says. What it signs in with it keeps in its store (console secret), never in a file or a message.",
            steps: start,
          },
        ]),
    {
      key: "browser" as const,
      who: "agent" as const,
      title: "Signing in elsewhere, in a browser",
      about:
        "For the agent, wherever its work has it sign in at a page: the git host, the mailbox, the messenger, a tool of the organization's.",
      steps: browser,
    },
    ...(asked.length === 0
      ? []
      : [
          {
            key: "asked" as const,
            who: "manager" as const,
            title: "What the agent asks for",
            about:
              "What the agent cannot do itself. It asks for each as a decision on the board, of whoever can do it, and of its manager where it does not know who, and goes on with the rest.",
            steps: asked,
          },
        ]),
  ];

  return {
    title: `Setting up ${called}`,
    about: [
      `This guide sets a machine up for the agent account ${called} of ${workspace.name}, whose console is at ${setup.console.url}. The account signs in there as \`${account.login}\` through ${provider}.`,
      `The code that opened this guide is an invitation and no credential: it says which account the setup is for, and gives nobody the account. It ends on its day, or when the account's command has signed in.`,
    ],
    expiresAt: setup.expiresAt,
    sections,
  };
}

const WHO: Readonly<Record<SetupRole, string>> = {
  operator: "whoever prepares the machine",
  agent: "the agent",
  manager: "its manager",
};

/**
 * The guide as the command prints it (ADR-0140): Markdown, every line to run on a line of its
 * own, and of its sections only those of whoever prepares the machine, since the command is run
 * by them. What the agent does when it starts and what it asks for are the agent's first task,
 * read by the agent in its own session: a session at the machine that read them took them for
 * its own work. `moment` says the invitation's day as the command says a moment; left out, as
 * the API gives it.
 */
export function setupGuideText(
  guide: SetupGuide,
  moment: (iso: string) => string = (iso) => iso,
): string {
  const lines: string[] = [
    `# ${guide.title}`,
    "",
    ...guide.about.flatMap((one) => [one, ""]),
    `The invitation is good until ${moment(guide.expiresAt)}.`,
    "",
  ];
  const own = guide.sections.filter((section) => section.who === "operator");
  for (const [index, section] of own.entries()) {
    lines.push(`## ${index + 1}. ${section.title} (${WHO[section.who]})`, "", section.about, "");
    for (const step of section.steps) {
      lines.push(`- ${step.title}. ${step.body}`);
      if (step.line !== undefined) {
        lines.push(`      ${step.line}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
