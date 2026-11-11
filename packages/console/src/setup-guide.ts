import type { RestAgentSetup, RestWorkspace } from "./schemas.js";
import { describeService, type ServiceItem, serviceNamesOf } from "./services.js";
import { type ProviderKey, SERVICE_ROLES, type ServiceRole } from "./vocabulary.js";

// The guide an invitation's code opens (ADR-0088): what setting a machine up for one agent
// account takes, written for that account and the services of its workspace, in the order it is
// done and by whom. `console agent setup --code` prints it for the agent, and `/setup/<code>`
// shows it to a person: one guide, made here from what the code opens, which is nothing secret.
// It is written in English, as a skill is, for an agent to read as it is. Where the setup needs
// something the agent does not have, the account it signs in with or what that account signs in
// with, the guide has the agent ask the person at the machine for it, in words it can say as
// they are, as the console's other skills have an agent ask (ADR-0094).

/** How the console's command gets onto a machine. */
export const SETUP_INSTALL = "npm i -g @skillcdn/console";

/** The command that sets a machine up for the account a code is the invitation of. */
export function setupCommandOf(origin: string, code: string): string {
  return `console agent setup --console ${origin} --code ${code}`;
}

/**
 * The sentence said to the agent's product on its machine. It carries the command as written,
 * so that the product runs it and reads the guide from the command's own words.
 */
export function setupSentenceOf(command: string): string {
  return `Run: ${command} (before it: ${SETUP_INSTALL}), then do what it prints`;
}

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
): GuideService[] {
  const names = serviceNamesOf(workspace, handle);
  const services: GuideService[] = [];
  for (const role of SERVICE_ROLES) {
    const service = workspace.services?.[role];
    if (service === undefined) {
      continue;
    }
    const said = describeService(role, service, names);
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
  const described = guideServicesOf(workspace, account.handle);
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
            body: `The account \`${account.login}\` at ${provider}, made if it is not there yet, and what it signs in with at hand when the machine is set up: the setup signs in with it once, in the machine's browser.`,
          },
        ]
      : []),
    {
      title: "An OS account of its own",
      body: "On the machine, make an OS account for the agent, apart from anyone else's. Whether it holds an administrator's rights is for whoever keeps the machine to say.",
    },
    {
      title: "Its product and the command",
      body: "In that OS account, install the agent's product (Claude Code, Codex or another) and sign it in with the agent's own subscription. Install Node.js 24 or later, and the console's command.",
      line: SETUP_INSTALL,
    },
    {
      title: "The one line",
      body: "Open a session of the product there and say this to it, or run the command it names in a terminal yourself. You act as yourself in the console, and never sign in to it on the agent's machine.",
      line: setupSentenceOf(command),
    },
  ];

  const machine: SetupGuideStep[] = [
    {
      title: "Ask for the sign-in before you go on",
      body: `If you are the agent, say this to the person at the machine, in these words or your own, and wait for the answer: "I am setting this machine up as @${account.handle}. The console signs me in as \`${account.login}\` through ${provider}. Is that account there? If it is not, make it now, or tell me to where I may. When the browser opens, sign in as that account yourself, or give me what it signs in with, and I type it." Go on once the account is there. Never sign in as anyone else, and never make up a login: the console takes this one and no other. If nobody is at the machine, ask whom you were set up by, and stop here until they answer.`,
    },
    {
      title: "The command asks to be signed in as the account",
      body: `After this guide the command goes on by itself, and waits. It opens an address in the machine's browser and prints it with a code: sign in there through ${provider} as \`${account.login}\`, check that the page shows the same code, and say that it is you. On a machine without a screen, open the address in any browser that is signed in as the account. If the page shows another member, sign out there first: nobody else's sign-in answers for the account, and the command gives up a sign-in that is not the account's. A password typed for the account here is the account's from then on: change it where the provider lets you, and keep the new one in your store once the command is signed in (\`console secret <name> --set\`).`,
    },
    {
      title: "It makes the machine the agent's",
      body: "Signed in, it reads the account and the services, writes the desk in the OS account's home from the template, or clones it where the account pushed one before, writes the service that keeps the runner running and starts it, and says the machine and the OS account, which the account's page shows. It needs no administrator's rights, and writes over no file of a desk that is there.",
    },
    {
      title: "Check who the command is",
      body: `It names @${account.handle}, and no person. From then on the invitation has done its work, and its code opens nothing.`,
      line: "console whoami",
    },
    {
      title: "When the services or the account change",
      body: "Run this in the desk: it writes what is missing there, writes the service again where it changed, and says the services as they are now.",
      line: "console agent setup --refresh",
    },
  ];

  const start: SetupGuideStep[] = described.flatMap((one) =>
    one.onboarding.map((item) => ({ title: item.title, body: item.body })),
  );
  // How the agent signs in at the services it works with, said once for all of them: a sign-in
  // is the agent's own, kept in the machine's own browser, and where it wants a person, a person
  // signs in inside the agent's session and nothing is sent in a message.
  const browser: SetupGuideStep[] = [
    {
      title: "Use the machine's own browser, and keep it",
      body: "Sign in at a service in the ordinary browser of your OS account, with a browser tool of your product that attaches to that browser. A sign-in stays there from one session to the next, as a person's does. A browser a tool starts anew each time keeps none, and a service takes it for a stranger each time and asks again.",
    },
    {
      title: "Where a sign-in wants a person",
      body: "A code sent to a phone, a picture to solve, a key to touch: ask for a person to sign in inside your session. They reach your OS account over a remote desktop, or sit at the machine, sign in as you in that same browser, and leave. Ask as a decision on the board, or at the messenger where it is quick, and say which service and which account. Nothing you sign in with is sent in a message, a task or a comment.",
    },
    {
      title: "Keep what you sign in with",
      body: "A password you chose or were handed goes into your store, with the day it ends where it has one: `console secret <service>.password --set --expires <day>`. Turn on a second step you can answer yourself where the service has one. `console secrets` lists what you keep, by name.",
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
      about:
        "For whoever prepares the machine: a person at its screen, or an agent that administers it.",
      steps: before,
    },
    {
      key: "machine",
      who: "agent",
      title: "On the machine",
      about:
        "For the agent, or whoever runs the command in its OS account. The account is entered through its own sign-in and through nothing else.",
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
              "What the agent does itself, with its own sign-ins. What it signs in with it keeps in its store (console secret), never in a file or a message.",
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
      "The skill running-an-agent, shipped with the console's command, says the whole of it for the three who have a part in it: whoever prepares the machine, the agent, and its manager.",
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
 * The guide as the command prints it: Markdown, every line to run on a line of its own. `moment`
 * says the invitation's day as the command says a moment; left out, as the API gives it.
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
  for (const [index, section] of guide.sections.entries()) {
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
