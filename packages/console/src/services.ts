import type { RestWorkspace, RestWorkspaceService } from "./schemas.js";
import type { ProviderKey, ServiceRole } from "./vocabulary.js";

// The services a workspace's agents work with (ADR-0089), and what each kind of service says of
// itself: a provider module in the package, as a product is a driver. The console prescribes no
// service; a kind names how an account there is called, what a person does there, what the
// agent does there when it starts, and what is asked of a person. A kind the package does not
// know is still named, with steps that say the least.

/** The three short names a name elsewhere is put together from. */
export interface ServiceNames {
  /** The workspace's handle (`acme`), where it has one. */
  readonly workspace: string | null;
  /** The agent account's handle (`mira`). */
  readonly agent: string;
  /** The workspace's mail and web domain (`acme.example`), where it has one. */
  readonly domain: string | null;
}

/** Something to do at a service, said in a line with what it takes. */
export interface ServiceItem {
  readonly title: string;
  readonly body: string;
}

export interface ServiceContext {
  readonly role: ServiceRole;
  readonly service: RestWorkspaceService;
  readonly names: ServiceNames;
  /** What the agent's account is called at the service, where a name is put together for it. */
  readonly account: string | undefined;
}

/** What one kind of service says of itself. */
export interface ServiceProvider {
  readonly kind: string;
  /** What people call it. */
  readonly name: string;
  /** The roles it may be named for. */
  readonly roles: readonly ServiceRole[];
  /** The template an account's name there is put together from, where the entry says no other. */
  readonly account: string | undefined;
  /** The provider the deployment signs people in through, where the service is one that signs in. */
  readonly signsInThrough: ProviderKey | undefined;
  /** The wake source its events reach an agent through, for a messenger that has one. */
  readonly wakeSource: string | undefined;
  /** What whoever sets an agent up does at the service before the agent starts, in order. */
  guide(context: ServiceContext): readonly string[];
  /** What the agent itself does at the service when it starts: items of its onboarding. */
  onboarding(context: ServiceContext): readonly ServiceItem[];
  /** What only a person can do there, with the exact values and what to hand back. */
  asks(context: ServiceContext): readonly ServiceItem[];
  /** Where the agent's desk is cloned from, for a git host that says; nothing for any other. */
  deskRemote(context: ServiceContext): string | undefined;
}

const PLACE = /\{(workspace|agent|domain)\}/g;

/**
 * A name put together from a template: `{workspace}`, `{agent}` and `{domain}` filled in.
 * Nothing where the template has a place the workspace has no name for: a name is never made of
 * half of what it is made of.
 */
export function fillTemplate(template: string, names: ServiceNames): string | undefined {
  let missing = false;
  const filled = template.replaceAll(PLACE, (_, place: "workspace" | "agent" | "domain") => {
    const value = names[place];
    if (value === null || value.length === 0) {
      missing = true;
      return "";
    }
    return value;
  });
  return missing ? undefined : filled;
}

const called = (account: string | undefined, otherwise: string): string =>
  account === undefined ? otherwise : `\`${account}\``;

const github: ServiceProvider = {
  kind: "github",
  name: "GitHub",
  roles: ["identity", "git"],
  account: "{workspace}-{agent}",
  signsInThrough: "gh",
  wakeSource: undefined,
  guide: ({ role, service, account }) => [
    `A person makes the account ${called(account, "of the agent")} at GitHub, with the agent's own mailbox where it has one: the host asks that a person make an account, and holds an organization to one account that a machine runs for each person who answers for it.`,
    ...(service.organization === undefined
      ? []
      : [
          `An owner of the organization \`${service.organization}\` invites ${called(account, "it")}, with the rights its work needs and no more.`,
        ]),
    ...(role === "identity"
      ? ["Its first password goes to whoever prepares the agent's machine, and to nobody else."]
      : []),
  ],
  onboarding: ({ role, service, account }) =>
    role !== "git"
      ? []
      : [
          {
            title: "Sign in at the git host and keep what you sign in with",
            body: `Sign in at GitHub as ${called(account, "your account")}${service.organization === undefined ? "" : `, accept the invitation to \`${service.organization}\``}, make a token for git that reaches the repositories you work in and nothing else, and keep it in your store with the day it ends: console secret git.token --set --expires <day>.`,
          },
          {
            title: "Make your desk there and push it",
            body: `Make the repository \`${account ?? "<your account>"}/desk\`, private, and push the desk to it.`,
          },
        ],
  asks: ({ service, account }) => [
    {
      title: `Make the account ${called(account, "of the agent")} at GitHub`,
      body: `The host's terms ask that a person make an account. Make ${called(account, "it")}${service.organization === undefined ? "" : `, invite it to \`${service.organization}\``}, and seed its first password where only the agent reads it.`,
    },
  ],
  deskRemote: ({ role, account }) =>
    role !== "git" || account === undefined ? undefined : `https://github.com/${account}/desk.git`,
};

const googleWorkspace: ServiceProvider = {
  kind: "google-workspace",
  name: "Google Workspace",
  roles: ["identity"],
  account: "{agent}@{domain}",
  signsInThrough: "google",
  wakeSource: undefined,
  guide: ({ account }) => [
    `An administrator of the Workspace makes the user ${called(account, "of the agent")}, with a mailbox: the agent signs in to the console with it, and it is its address everywhere else.`,
    "Its first password goes to whoever prepares the agent's machine, and to nobody else; the agent changes it at its first sign-in and keeps the new one in its store.",
  ],
  onboarding: ({ account }) => [
    {
      title: "Make the account your own",
      body: `Sign in as ${called(account, "your account")}, change the first password and keep the new one in your store (console secret mail.password --set), and turn on a second step you can answer yourself.`,
    },
  ],
  asks: () => [],
  deskRemote: () => undefined,
};

const slack: ServiceProvider = {
  kind: "slack",
  name: "Slack",
  roles: ["messenger"],
  account: undefined,
  signsInThrough: undefined,
  wakeSource: "slack",
  guide: ({ service }) => [
    `An administrator of ${service.workspace === undefined ? "the Slack workspace" : `\`${service.workspace}\``} invites the agent's own address as a member: it is a member there as a person is, called by its name.`,
  ],
  onboarding: ({ service }) => [
    {
      title: "Join the messenger and say who you are",
      body: `Accept the invitation to ${service.workspace === undefined ? "the Slack workspace" : `\`${service.workspace}\``} with your own address, set your name, your title and your picture (console agent <handle> --avatar <file> writes the file), and say in your profile that you are an agent.`,
    },
    {
      title: "Connect the messenger to your product, and be woken by it",
      body: "Add the messenger's own MCP server to your product, and make the app that wakes you from the manifest your skill carries; keep its tokens in your store.",
    },
  ],
  asks: ({ service, names }) => [
    {
      title: `Invite ${names.agent} to the messenger`,
      body: `Invite the agent's own address to ${service.workspace === undefined ? "the Slack workspace" : `\`${service.workspace}\``} as a member, and approve the app it asks to install for itself.`,
    },
  ],
  deskRemote: () => undefined,
};

/** The kinds the package knows. */
export const SERVICE_PROVIDERS: readonly ServiceProvider[] = [github, googleWorkspace, slack];

/** What a kind the package does not know says: the least, in words that fit any service. */
function generic(kind: string): ServiceProvider {
  return {
    kind,
    name: kind,
    roles: ["identity", "git", "messenger"],
    account: undefined,
    signsInThrough: undefined,
    wakeSource: undefined,
    guide: () => [
      `Make the agent an account of its own at ${kind}, as a person's is made there, and hand what it signs in with to nobody but whoever prepares its machine.`,
    ],
    onboarding: () => [
      {
        title: `Sign in at ${kind}`,
        body: `Sign in at ${kind} with your own account and keep what you sign in with in your store.`,
      },
    ],
    asks: () => [],
    deskRemote: () => undefined,
  };
}

/** The module of a kind: the package's own, or the generic one for a kind it does not know. */
export function serviceProviderOf(kind: string): ServiceProvider {
  return SERVICE_PROVIDERS.find((provider) => provider.kind === kind) ?? generic(kind);
}

/** The names a workspace gives a name's template, for one agent account. */
export function serviceNamesOf(
  workspace: Pick<RestWorkspace, "handle" | "domain">,
  agent: string,
): ServiceNames {
  return { workspace: workspace.handle ?? null, agent, domain: workspace.domain ?? null };
}

/**
 * What an agent account is called at a service: the entry's own template where it names one,
 * else its kind's; nothing where neither says, or a place has no name yet.
 */
export function serviceAccountOf(
  service: RestWorkspaceService,
  names: ServiceNames,
): string | undefined {
  const template = service.account ?? serviceProviderOf(service.kind ?? "").account;
  return template === undefined ? undefined : fillTemplate(template, names);
}

/** A service of the workspace with everything its module says of it for one agent account. */
export function describeService(
  role: ServiceRole,
  service: RestWorkspaceService,
  names: ServiceNames,
): {
  readonly provider: ServiceProvider;
  readonly account: string | undefined;
  readonly guide: readonly string[];
  readonly onboarding: readonly ServiceItem[];
  readonly asks: readonly ServiceItem[];
} {
  const provider = serviceProviderOf(service.kind ?? "");
  const account = serviceAccountOf(service, names);
  const context: ServiceContext = { role, service, names, account };
  return {
    provider,
    account,
    guide: provider.guide(context),
    onboarding: provider.onboarding(context),
    asks: provider.asks(context),
  };
}

/**
 * Where an agent account's desk is cloned from, as the module of the workspace's git host says:
 * nothing where the workspace names no git host, the kind does not say, or the account's name
 * there cannot be put together yet.
 */
export function deskRemoteOf(
  workspace: Pick<RestWorkspace, "handle" | "domain" | "services">,
  agent: string,
): string | undefined {
  const git = workspace.services?.git;
  if (git === undefined) {
    return undefined;
  }
  const names = serviceNamesOf(workspace, agent);
  return serviceProviderOf(git.kind ?? "").deskRemote({
    role: "git",
    service: git,
    names,
    account: serviceAccountOf(git, names),
  });
}

/**
 * The account an agent signs in to the console with, as the workspace's identity service names
 * it: the provider the deployment signs people in through, and the login there. Nothing where
 * the workspace names no identity service, or the name cannot be put together yet.
 */
export function agentLoginOf(
  workspace: Pick<RestWorkspace, "handle" | "domain" | "services">,
  agent: string,
): { readonly host: ProviderKey; readonly login: string } | undefined {
  const identity = workspace.services?.identity;
  if (identity === undefined) {
    return undefined;
  }
  const host = serviceProviderOf(identity.kind ?? "").signsInThrough;
  const login = serviceAccountOf(identity, serviceNamesOf(workspace, agent));
  return host === undefined || login === undefined ? undefined : { host, login };
}
