import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { CredentialsError } from "../ports/credentials.js";
import { createContainerCredentials } from "./container-credentials.js";

// The platform's credentials endpoint against a fake that never leaves the process: what is
// asked, when it is asked again, what is kept while the endpoint is away, and what is refused.

const URL_OF_ENDPOINT = "http://169.254.170.2/v2/credentials/abc-123";

function endpoint(answer: () => Response | Promise<Response>) {
  const requests: { url: string; headers: Record<string, string> }[] = [];
  const fetchLike = async (input: string, init: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    requests.push({ url: request.url, headers: Object.fromEntries(request.headers.entries()) });
    return answer();
  };
  return { requests, fetch: fetchLike };
}

const handed = (suffix: string, expiration: string | undefined) =>
  Response.json({
    AccessKeyId: `ASIA${suffix}`,
    SecretAccessKey: `secret-${suffix}`,
    Token: `token-${suffix}`,
    ...(expiration === undefined ? {} : { Expiration: expiration }),
    RoleArn: "arn:aws:iam::000000000000:role/console-task",
  });

describe("the platform's credentials", () => {
  const start = new Date("2026-10-11T10:00:00Z");

  it("asks once, keeps the answer until shortly before it expires, then asks again", async () => {
    let now = start;
    let suffix = "one";
    const at = endpoint(() => handed(suffix, "2026-10-11T11:00:00Z"));
    const source = createContainerCredentials({
      url: URL_OF_ENDPOINT,
      clock: { now: () => now },
      logger: pino({ level: "silent" }),
      fetch: at.fetch,
    });
    expect(await source.credentials()).toEqual({
      accessKeyId: "ASIAone",
      secretAccessKey: "secret-one",
      sessionToken: "token-one",
    });
    expect(at.requests).toEqual([
      { url: URL_OF_ENDPOINT, headers: { accept: "application/json" } },
    ]);
    suffix = "two";
    now = new Date("2026-10-11T10:54:00Z");
    expect((await source.credentials()).accessKeyId).toBe("ASIAone");
    expect(at.requests).toHaveLength(1);
    now = new Date("2026-10-11T10:56:00Z");
    expect((await source.credentials()).accessKeyId).toBe("ASIAtwo");
    expect(at.requests).toHaveLength(2);
  });

  it("asks once for everyone waiting at the same time", async () => {
    const at = endpoint(() => handed("one", "2026-10-11T11:00:00Z"));
    const source = createContainerCredentials({
      url: URL_OF_ENDPOINT,
      clock: { now: () => start },
      logger: pino({ level: "silent" }),
      fetch: at.fetch,
    });
    const answers = await Promise.all([source.credentials(), source.credentials()]);
    expect(answers.map((answer) => answer.accessKeyId)).toEqual(["ASIAone", "ASIAone"]);
    expect(at.requests).toHaveLength(1);
  });

  it("sends the authorization the platform wants, from its value or from its file, read each time", async () => {
    const at = endpoint(() => handed("one", "2026-10-11T11:00:00Z"));
    const fixed = createContainerCredentials({
      url: URL_OF_ENDPOINT,
      authorization: "a-bearer-token",
      clock: { now: () => start },
      logger: pino({ level: "silent" }),
      fetch: at.fetch,
    });
    await fixed.credentials();
    expect(at.requests[0]?.headers.authorization).toBe("a-bearer-token");

    let now = start;
    let fromFile = "first\n";
    const rotated = createContainerCredentials({
      url: "https://credentials.example.test/task",
      authorizationFile: "/var/run/credentials/token",
      clock: { now: () => now },
      logger: pino({ level: "silent" }),
      fetch: at.fetch,
      readFile: (path) => {
        expect(path).toBe("/var/run/credentials/token");
        return fromFile;
      },
    });
    await rotated.credentials();
    expect(at.requests[1]?.headers.authorization).toBe("first");
    fromFile = "second\n";
    now = new Date("2026-10-11T10:59:00Z");
    await rotated.credentials();
    expect(at.requests[2]?.headers.authorization).toBe("second");

    const unreadable = createContainerCredentials({
      url: URL_OF_ENDPOINT,
      authorizationFile: "/var/run/credentials/token",
      clock: { now: () => start },
      logger: pino({ level: "silent" }),
      fetch: at.fetch,
      readFile: () => {
        throw new Error("ENOENT");
      },
    });
    await expect(unreadable.credentials()).rejects.toMatchObject({
      code: "credentials.unavailable",
      message: "the platform's authorization token could not be read",
    });
    expect(at.requests).toHaveLength(3);
  });

  it("keeps what it has while the platform is away, until that expires", async () => {
    let now = start;
    let away = false;
    const at = endpoint(() => {
      if (away) {
        throw new TypeError("fetch failed");
      }
      return handed("one", "2026-10-11T11:00:00Z");
    });
    const source = createContainerCredentials({
      url: URL_OF_ENDPOINT,
      clock: { now: () => now },
      logger: pino({ level: "silent" }),
      fetch: at.fetch,
    });
    await source.credentials();
    away = true;
    now = new Date("2026-10-11T10:57:00Z");
    expect((await source.credentials()).accessKeyId).toBe("ASIAone");
    now = new Date("2026-10-11T11:00:01Z");
    const error = await source.credentials().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(CredentialsError);
    expect(error).toMatchObject({
      code: "credentials.unavailable",
      message: "the platform's credentials endpoint could not be reached",
    });
    expect((error as CredentialsError).cause).toBeInstanceOf(TypeError);
    // Asked again once the platform is back: nothing of the failure is kept.
    away = false;
    expect((await source.credentials()).accessKeyId).toBe("ASIAone");
  });

  it("keeps an answer without an expiration for a while, and refuses what is not an answer", async () => {
    let now = start;
    const at = endpoint(() => handed("one", undefined));
    const source = createContainerCredentials({
      url: URL_OF_ENDPOINT,
      clock: { now: () => now },
      logger: pino({ level: "silent" }),
      fetch: at.fetch,
    });
    await source.credentials();
    now = new Date("2026-10-11T10:09:00Z");
    await source.credentials();
    expect(at.requests).toHaveLength(1);
    now = new Date("2026-10-11T10:11:00Z");
    await source.credentials();
    expect(at.requests).toHaveLength(2);

    for (const [answer, message] of [
      [
        () => new Response("<Error/>", { status: 403 }),
        "the platform's credentials endpoint answered 403",
      ],
      [
        () => new Response("not json", { status: 200 }),
        "the platform's credentials endpoint answered something that is not JSON",
      ],
      [
        () => Response.json({ AccessKeyId: "ASIAone" }),
        "the platform's credentials endpoint answered in an unexpected shape",
      ],
      [
        () => Response.json({ AccessKeyId: "ASIAone", SecretAccessKey: "s", Expiration: "soon" }),
        "the platform's credentials endpoint answered in an unexpected shape",
      ],
      [
        () => new Response(new Uint8Array(17 * 1024), { status: 200 }),
        "the platform's credentials endpoint answered more than expected",
      ],
    ] as const) {
      const refused = createContainerCredentials({
        url: URL_OF_ENDPOINT,
        clock: { now: () => start },
        logger: pino({ level: "silent" }),
        fetch: endpoint(answer).fetch,
      });
      await expect(refused.credentials(), message).rejects.toMatchObject({
        code: "credentials.unavailable",
        message,
      });
    }
  });
});
