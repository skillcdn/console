import {
  CLIENT_POLICY,
  CLIENT_RANGE_HEADER,
  type ClientPolicy,
  clientRange,
  clientVersionOf,
  formatRange,
  formatVersion,
  judgeClient,
  parseVersion,
  VERSION_HEADER,
  type Version,
} from "@skillcdn/console/api";
import { createMiddleware } from "hono/factory";
import { errorBody } from "./app.js";
import type { AppEnv } from "./request-context.js";

// The console holds the command to the versions it takes (ADR-0025): every answer of the API
// says the console's version and the range, and a command that names a version outside it is
// refused with 426 and the words to update, before anything else is asked of its request. A
// request that names no command, a browser's or a script's, passes as it always did. The
// judgement is a few comparisons on a header already read: no request is added anywhere.

export interface VersionFacts {
  /** The console's version, as the package spells it. */
  readonly version: string;
  /** The range of command versions this console takes, as npm spells one. */
  readonly clientRange: string;
  readonly parsed: Version;
  readonly policy: ClientPolicy;
}

/** The console's version as the package states it, with the range it takes; a text that is not a version is a packaging fault. */
export function versionFactsOf(text: string, policy: ClientPolicy = CLIENT_POLICY): VersionFacts {
  const parsed = parseVersion(text);
  if (parsed === undefined) {
    throw new Error(`the version of the console is not one: ${text}`);
  }
  return {
    version: formatVersion(parsed),
    clientRange: formatRange(clientRange(parsed, policy)),
    parsed,
    policy,
  };
}

export function clientVersionGate(facts: VersionFacts) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const client = clientVersionOf(c.req.header("user-agent"));
    if (client !== undefined) {
      const { verdict } = judgeClient(client, facts.parsed, facts.policy);
      if (verdict === "outdated" || verdict === "too_new") {
        c.header(VERSION_HEADER, facts.version);
        c.header(CLIENT_RANGE_HEADER, facts.clientRange);
        c.header("cache-control", "no-store");
        const named = formatVersion(client);
        const takes = `${facts.clientRange}; the console is ${facts.version}`;
        return c.json(
          verdict === "outdated"
            ? errorBody(
                "client.outdated",
                `This command, ${named}, is older than this console takes (${takes}). Update it to ${facts.version}.`,
              )
            : errorBody(
                "client.too_new",
                `This command, ${named}, is newer than this console takes (${takes}). Install the console's version, or ask its operator to update the console.`,
              ),
          426,
        );
      }
    }
    await next();
    c.header(VERSION_HEADER, facts.version);
    c.header(CLIENT_RANGE_HEADER, facts.clientRange);
  });
}
