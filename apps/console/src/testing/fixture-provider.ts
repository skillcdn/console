import { createHash } from "node:crypto";
import type { ProviderKey } from "@skillcdn/console/api";
import {
  type IdentityProvider,
  type ProviderAccount,
  ProviderError,
} from "../ports/identity-provider.js";

// Test support: an identity provider's side of signing in, for a handful of people. The git
// host knows three, and a few more that sign in only on the console a person looks at the pages
// on; the Workspace knows two, one of a domain and one of none. Not compiled.

export interface FixtureProvider extends IdentityProvider {
  readonly people: Readonly<Record<string, ProviderAccount>>;
  /** Calls per port method, to assert how often the provider was asked. */
  readonly calls: Record<"exchangeCode" | "getAccount", number>;
  /** The code the provider would send a person's browser back with, for the sign-in `state` began. */
  codeFor(person: string, state: string): string;
  /** Makes every call fail as a provider that cannot be reached does, until called with `false`. */
  unreachable(down: boolean): void;
}

export const FIXTURE_WEB_URL = "https://git.test";
export const FIXTURE_ACCOUNTS_URL = "https://accounts.test";

export interface FixtureProviderOptions {
  /**
   * Where the provider sends a browser to authorize, in place of the fixture's own host, which
   * no browser reaches: for a console a real browser signs in at, a route of the test's own that
   * answers as the host would, with the code for the person whose sign-in it is.
   */
  readonly authorize?: (() => string) | undefined;
  /**
   * What the provider says otherwise of its own people, by name: an account renamed at the
   * provider, or made again there under another id, for a sign-in after the first.
   */
  readonly changed?: Readonly<Record<string, Partial<ProviderAccount>>> | undefined;
}

/** An account of the git host that says no more of itself than its login. */
const plain = (accountId: string, login: string, name?: string): ProviderAccount => ({
  accountId,
  login,
  name,
  avatarUrl: undefined,
  domain: undefined,
});

/**
 * The git host's accounts beyond the three, which sign in only where something lets them in: the
 * console a person looks at the pages on lets them in for its invented work (`preview-board.ts`),
 * three more people and the accounts its agent accounts sign in with.
 */
const PREVIEW_PEOPLE: Readonly<Record<string, ProviderAccount>> = {
  dana: plain("1004", "dana", "Dana Okafor"),
  eli: plain("1005", "eli", "Eli Brandt"),
  gus: plain("1006", "gus", "Gus Hale"),
  "acme-mira": plain("1101", "acme-mira"),
  "acme-juno": plain("1102", "acme-juno"),
  "acme-otis": plain("1103", "acme-otis"),
  "acme-wren": plain("1104", "acme-wren"),
  "acme-pax": plain("1105", "acme-pax"),
};

const PEOPLE: Readonly<Record<ProviderKey, Readonly<Record<string, ProviderAccount>>>> = {
  gh: {
    alice: {
      accountId: "1001",
      login: "Alice",
      name: "Alice Example",
      avatarUrl: "https://avatars.example/alice.png",
      domain: undefined,
    },
    bob: {
      accountId: "1002",
      login: "bob",
      name: undefined,
      avatarUrl: undefined,
      domain: undefined,
    },
    carol: {
      accountId: "1003",
      login: "carol",
      name: "Carol",
      avatarUrl: undefined,
      domain: undefined,
    },
    ...PREVIEW_PEOPLE,
  },
  google: {
    dave: {
      accountId: "2001",
      login: "dave@acme.test",
      email: "dave@acme.test",
      name: "Dave Example",
      avatarUrl: "https://pictures.example/dave.png",
      domain: "acme.test",
    },
    erin: {
      accountId: "2002",
      login: "erin@mail.test",
      email: "erin@mail.test",
      name: undefined,
      avatarUrl: undefined,
      domain: undefined,
    },
  },
};

export function createFixtureProvider(
  key: ProviderKey = "gh",
  options: FixtureProviderOptions = {},
): FixtureProvider {
  const people: Record<string, ProviderAccount> = { ...PEOPLE[key] };
  for (const [name, change] of Object.entries(options.changed ?? {})) {
    const account = people[name];
    if (account === undefined) {
      throw new Error(`the fixture provider knows nobody called ${name}`);
    }
    people[name] = { ...account, ...change };
  }
  const calls = { exchangeCode: 0, getAccount: 0 };
  /** What a sign-in was started with, by its state: the challenge a code is redeemed against. */
  const started = new Map<string, string>();
  const codes = new Map<string, { readonly person: string; readonly challenge: string }>();
  const tokens = new Map<string, string>();
  let issued = 0;
  let down = false;

  const reach = (): void => {
    if (down) {
      throw new ProviderError("transient", "the provider could not be reached");
    }
  };

  return {
    key,
    label: key === "gh" ? "GitHub" : "Google",
    people,
    calls,
    codeFor(person, state) {
      const challenge = started.get(state);
      if (challenge === undefined || people[person] === undefined) {
        throw new Error(`no sign-in was started with state ${state}`);
      }
      const code = `code_${person}_${codes.size + 1}`;
      codes.set(code, { person, challenge });
      return code;
    },
    unreachable(value) {
      down = value;
    },

    authorizationUrl(request) {
      started.set(request.state, request.codeChallenge);
      const query = new URLSearchParams({
        state: request.state,
        redirect_uri: request.redirectUri,
        code_challenge: request.codeChallenge,
      });
      const base =
        options.authorize === undefined
          ? `${key === "gh" ? FIXTURE_WEB_URL : FIXTURE_ACCOUNTS_URL}/login/oauth/authorize`
          : options.authorize();
      return `${base}?${query}`;
    },

    async exchangeCode(request) {
      calls.exchangeCode += 1;
      reach();
      const code = codes.get(request.code);
      codes.delete(request.code);
      const challenge = createHash("sha256").update(request.codeVerifier).digest("base64url");
      if (code === undefined || code.challenge !== challenge) {
        throw new ProviderError("unauthorized", "the provider refused the token request");
      }
      issued += 1;
      const accessToken = `${key === "gh" ? "ghu" : "ya29"}_${code.person}_${issued}`;
      tokens.set(accessToken, code.person);
      return { accessToken };
    },

    async getAccount(accessToken) {
      calls.getAccount += 1;
      reach();
      const person = tokens.get(accessToken);
      const account = person === undefined ? undefined : people[person];
      if (account === undefined) {
        throw new ProviderError("unauthorized", "the provider refused the credential");
      }
      return account;
    },
  };
}
