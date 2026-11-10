import { describe, expect, it } from "vitest";
import { isDomain, restWorkspacePatchSchema, serviceProblem } from "./schemas.js";
import {
  agentLoginOf,
  describeService,
  fillTemplate,
  SERVICE_PROVIDERS,
  serviceAccountOf,
  serviceNamesOf,
  serviceProviderOf,
} from "./services.js";

// The services a workspace's agents work with (ADR-0089): the names put together from the two
// handles and the domain, what each kind says of itself, and what an administrator may name.

const ACME = { workspace: "acme", agent: "mira", domain: "acme.example" };

describe("a name at a service", () => {
  it("is put together from the workspace's short name, the agent's handle and the domain", () => {
    expect(fillTemplate("{agent}@{domain}", ACME)).toBe("mira@acme.example");
    expect(fillTemplate("{workspace}-{agent}", ACME)).toBe("acme-mira");
    expect(fillTemplate("{agent}.{workspace}@{domain}", ACME)).toBe("mira.acme@acme.example");
    expect(fillTemplate("bots-{agent}", ACME)).toBe("bots-mira");
    // A place the workspace has no name for leaves no name at all, never half of one.
    expect(fillTemplate("{agent}@{domain}", { ...ACME, domain: null })).toBeUndefined();
    expect(fillTemplate("{workspace}-{agent}", { ...ACME, workspace: "" })).toBeUndefined();
    // What is no place stays as it is written.
    expect(fillTemplate("{org}-{agent}", ACME)).toBe("{org}-mira");
  });

  it("comes from the service's own way, unless the entry says another", () => {
    expect(serviceAccountOf({ kind: "github", organization: "acme" }, ACME)).toBe("acme-mira");
    expect(serviceAccountOf({ kind: "google-workspace" }, ACME)).toBe("mira@acme.example");
    expect(serviceAccountOf({ kind: "github", account: "{agent}-{workspace}" }, ACME)).toBe(
      "mira-acme",
    );
    // A messenger gives its members no name of its own making; an unknown kind none either.
    expect(serviceAccountOf({ kind: "slack", workspace: "acme.slack.com" }, ACME)).toBeUndefined();
    expect(serviceAccountOf({ kind: "forgejo" }, ACME)).toBeUndefined();
    expect(serviceAccountOf({ kind: "forgejo", account: "{agent}" }, ACME)).toBe("mira");
  });

  it("is the login an agent account signs in to the console with, at the identity service", () => {
    const workspace = { handle: "acme", domain: "acme.example" };
    expect(
      agentLoginOf({ ...workspace, services: { identity: { kind: "google-workspace" } } }, "mira"),
    ).toEqual({ host: "google", login: "mira@acme.example" });
    expect(
      agentLoginOf({ ...workspace, services: { identity: { kind: "github" } } }, "mira"),
    ).toEqual({ host: "gh", login: "acme-mira" });
    // No identity service, one nobody signs in through, or a name that cannot be made yet.
    expect(agentLoginOf({ ...workspace, services: {} }, "mira")).toBeUndefined();
    expect(agentLoginOf(workspace, "mira")).toBeUndefined();
    expect(
      agentLoginOf({ ...workspace, services: { identity: { kind: "okta" } } }, "mira"),
    ).toBeUndefined();
    expect(
      agentLoginOf(
        { handle: "acme", domain: null, services: { identity: { kind: "google-workspace" } } },
        "mira",
      ),
    ).toBeUndefined();
    expect(serviceNamesOf({ handle: undefined, domain: undefined }, "mira")).toEqual({
      workspace: null,
      agent: "mira",
      domain: null,
    });
  });
});

describe("what a kind of service says of itself", () => {
  it("names the account, the organization and what a person does there, in the guide and in what is asked", () => {
    const git = describeService("git", { kind: "github", organization: "acme" }, ACME);
    expect(git.provider.name).toBe("GitHub");
    expect(git.account).toBe("acme-mira");
    expect(git.guide.join("\n")).toContain("`acme-mira`");
    expect(git.guide.join("\n")).toContain("`acme`");
    expect(git.asks[0]?.title).toBe("Make the account `acme-mira` at GitHub");
    // The agent's own part: its token in its store, and its desk in its own account.
    const onboarding = git.onboarding.map((item) => item.body).join("\n");
    expect(onboarding).toContain("console secret git.token --set");
    expect(onboarding).toContain("`acme-mira/desk`");
    // Named for signing in, it has the agent push nothing there.
    expect(describeService("identity", { kind: "github" }, ACME).onboarding).toEqual([]);

    const identity = describeService("identity", { kind: "google-workspace" }, ACME);
    expect(identity.guide[0]).toContain("`mira@acme.example`");
    expect(identity.asks).toEqual([]);
    const messenger = describeService(
      "messenger",
      { kind: "slack", workspace: "acme.slack.com" },
      ACME,
    );
    expect(messenger.provider.wakeSource).toBe("slack");
    expect(messenger.guide[0]).toContain("`acme.slack.com`");
    expect(messenger.asks[0]?.title).toBe("Invite mira to the messenger");
  });

  it("says the least of a kind the package does not know, and never nothing", () => {
    const provider = serviceProviderOf("forgejo");
    expect(provider).toMatchObject({ kind: "forgejo", name: "forgejo", account: undefined });
    const described = describeService("git", { kind: "forgejo", url: "git.acme.example" }, ACME);
    expect(described.guide).toHaveLength(1);
    expect(described.guide[0]).toContain("forgejo");
    expect(described.onboarding).toHaveLength(1);
    expect(SERVICE_PROVIDERS.map((one) => one.kind)).toEqual([
      "github",
      "google-workspace",
      "slack",
    ]);
    // Says nothing of a secret, whatever the kind.
    for (const one of SERVICE_PROVIDERS) {
      const text = JSON.stringify(
        describeService(one.roles[0] ?? "git", { kind: one.kind }, ACME),
      ).toLowerCase();
      expect(text, one.kind).not.toContain("password is");
    }
  });
});

describe("a service as an administrator names one", () => {
  it("takes a kind the package knows with its own parameters, for a role it may have", () => {
    expect(serviceProblem("git", { kind: "github", organization: "acme" })).toBeUndefined();
    expect(serviceProblem("identity", { kind: "github" })).toBeUndefined();
    expect(
      serviceProblem("identity", { kind: "google-workspace", account: "{agent}@{domain}" }),
    ).toBeUndefined();
    expect(
      serviceProblem("messenger", { kind: "slack", workspace: "acme.slack.com" }),
    ).toBeUndefined();
    // A kind it does not know is kept with what it came with.
    expect(
      serviceProblem("git", { kind: "forgejo", url: "git.acme.example", team: "agents" }),
    ).toBeUndefined();
    for (const [role, service] of [
      ["messenger", { kind: "github" }],
      ["git", { kind: "slack" }],
      ["git", { kind: "google-workspace" }],
      ["git", { kind: "github", organization: "not a name" }],
      ["git", { kind: "github", organisation: "acme" }],
      ["git", { kind: "github", account: "{agent}/../x" }],
      ["git", { kind: "github", account: "{org}-{agent}" }],
      ["messenger", { kind: "slack", workspace: "https://acme.slack.com/" }],
      ["git", {}],
      ["git", { kind: "GitHub" }],
      ["git", { kind: "../etc" }],
      ["git", { kind: "forgejo", "a parameter": "x" }],
      ["git", { kind: "forgejo", __proto__x: "x" }],
      [
        "git",
        Object.fromEntries([
          ["kind", "forgejo"],
          ...Array.from({ length: 9 }, (_, index) => [`p${index}`, "x"]),
        ]),
      ],
    ] as const) {
      expect(serviceProblem(role, service), JSON.stringify(service)).toBeDefined();
    }
  });

  it("is read by the patch as data: short lines, a domain that is one, a short name that is one", () => {
    const patch = (value: unknown) => restWorkspacePatchSchema.safeParse(value).success;
    expect(
      patch({
        handle: "acme",
        domain: "acme.example",
        services: {
          identity: { kind: "google-workspace" },
          git: { kind: "github", organization: "acme" },
          messenger: null,
        },
      }),
    ).toBe(true);
    expect(patch({ handle: null, domain: null })).toBe(true);
    for (const value of [
      { handle: "Acme" },
      { handle: "-acme" },
      { handle: "a" },
      { domain: "acme" },
      { domain: "ACME.example" },
      { domain: "acme.example/path" },
      { domain: "-acme.example" },
      { domain: `${"a".repeat(64)}.example` },
      { services: { git: { kind: "slack" } } },
      { services: { git: { kind: "github", organization: "x".repeat(300) } } },
      { services: { git: { kind: "github", organization: "acme\nevil" } } },
      { services: { git: { kind: "github", organization: 7 } } },
      { services: { git: "github" } },
      { services: { git: { kind: "github", nested: { a: "b" } } } },
    ]) {
      expect(patch(value), JSON.stringify(value).slice(0, 70)).toBe(false);
    }
    // A role nobody named is not one: it is left out, and nothing is left to change.
    expect(patch({ services: { calendar: { kind: "google-workspace" } } })).toBe(true);
    expect(
      restWorkspacePatchSchema.parse({ services: { calendar: { kind: "x" } } }).services,
    ).toEqual({});
    expect(isDomain("acme.example")).toBe(true);
    expect(isDomain("mail.acme.co.kr")).toBe(true);
    expect(isDomain("localhost")).toBe(false);
    expect(isDomain("acme..example")).toBe(false);
  });
});
