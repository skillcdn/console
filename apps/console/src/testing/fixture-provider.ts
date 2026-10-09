import { createHash } from "node:crypto";
import type { ProviderKey } from "@skillcdn/console/api";
import {
  type IdentityProvider,
  type ProviderAccount,
  ProviderError,
} from "../ports/identity-provider.js";

// Test support: an identity provider's side of signing in, for a handful of people. The git
// host knows three; the Workspace knows two, one of a domain and one of none. Not compiled.

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
  },
  google: {
    dave: {
      accountId: "2001",
      login: "dave@acme.test",
      name: "Dave Example",
      avatarUrl: "https://pictures.example/dave.png",
      domain: "acme.test",
    },
    erin: {
      accountId: "2002",
      login: "erin@mail.test",
      name: undefined,
      avatarUrl: undefined,
      domain: undefined,
    },
  },
};

export function createFixtureProvider(key: ProviderKey = "gh"): FixtureProvider {
  const people = PEOPLE[key];
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
      const base = key === "gh" ? FIXTURE_WEB_URL : FIXTURE_ACCOUNTS_URL;
      return `${base}/login/oauth/authorize?${query}`;
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
