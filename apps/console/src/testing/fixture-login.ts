import { createHash } from "node:crypto";
import { GitHostError, type GitHostLogin, type HostAccount } from "../ports/git-host-login.js";

// Test support: the git host's side of signing in, for a handful of people. Not compiled.

export interface FixtureLogin extends GitHostLogin {
  readonly people: Readonly<Record<string, HostAccount>>;
  /** Calls per port method, to assert how often the host was asked. */
  readonly calls: Record<"exchangeCode" | "getAccount", number>;
  /** The code the host would send a person's browser back with, for the sign-in `state` began. */
  codeFor(person: string, state: string): string;
  /** Makes every call fail as a host that cannot be reached does, until called with `false`. */
  unreachable(down: boolean): void;
}

export const FIXTURE_WEB_URL = "https://git.test";

export function createFixtureLogin(): FixtureLogin {
  const people: Record<string, HostAccount> = {
    alice: {
      hostAccountId: "1001",
      login: "Alice",
      name: "Alice Example",
      avatarUrl: "https://avatars.example/alice.png",
    },
    bob: { hostAccountId: "1002", login: "bob", name: undefined, avatarUrl: undefined },
    carol: { hostAccountId: "1003", login: "carol", name: "Carol", avatarUrl: undefined },
  };
  const calls = { exchangeCode: 0, getAccount: 0 };
  /** What a sign-in was started with, by its state: the challenge a code is redeemed against. */
  const started = new Map<string, string>();
  const codes = new Map<string, { readonly person: string; readonly challenge: string }>();
  const tokens = new Map<string, string>();
  let issued = 0;
  let down = false;

  const reach = (): void => {
    if (down) {
      throw new GitHostError("transient", "the git host could not be reached");
    }
  };

  return {
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
      return `${FIXTURE_WEB_URL}/login/oauth/authorize?${query}`;
    },

    async exchangeCode(request) {
      calls.exchangeCode += 1;
      reach();
      const code = codes.get(request.code);
      codes.delete(request.code);
      const challenge = createHash("sha256").update(request.codeVerifier).digest("base64url");
      if (code === undefined || code.challenge !== challenge) {
        throw new GitHostError("unauthorized", "the git host refused the token request");
      }
      issued += 1;
      const accessToken = `ghu_${code.person}_${issued}`;
      tokens.set(accessToken, code.person);
      return { accessToken };
    },

    async getAccount(accessToken) {
      calls.getAccount += 1;
      reach();
      const person = tokens.get(accessToken);
      const account = person === undefined ? undefined : people[person];
      if (account === undefined) {
        throw new GitHostError("unauthorized", "the git host refused the credential");
      }
      return account;
    },
  };
}
