import type { FetchLike } from "@skillcdn/client";
import { parseAddress } from "@skillcdn/core";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { PackError } from "../ports/skill-source.js";
import { createSkillCdnSource } from "./skillcdn.js";

const ADDRESS = (() => {
  const parsed = parseAddress("/gh/acme/skills");
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  return parsed.value;
})();

/** A mount overview as the deployment answers one, with the parts the console reads filled in. */
const READY = {
  address: "/gh/acme/skills",
  repository: {
    host: "gh",
    owner: "acme",
    name: "skills",
    defaultBranch: "main",
    description: null,
    avatar: "https://avatars.example/acme.png",
  },
  ref: null,
  pinned: false,
  commit: "0123456789abcdef0123456789abcdef01234567",
  path: "",
  verified: false,
  image: null,
  index: {
    status: "ready",
    truncated: false,
    manifest: null,
    skillCount: 1,
    documentCount: 0,
    skills: [
      {
        path: "skills/release-notes/SKILL.md",
        name: "release-notes",
        directory: "skills/release-notes",
        description: "Writes the notes of a release.",
        warnings: [],
        translations: { ko: { title: "릴리스 노트", description: null } },
      },
    ],
    documents: [],
    diagnostics: [],
  },
};

function source(answer: FetchLike) {
  const logs: Record<string, unknown>[] = [];
  const logger = pino(
    { level: "warn" },
    { write: (line: string) => logs.push(JSON.parse(line) as Record<string, unknown>) },
  );
  return {
    source: createSkillCdnSource({
      baseUrl: "https://skillcdn.test",
      userAgent: "console-test",
      logger,
      fetch: answer,
      timeoutMs: 1000,
    }),
    logs,
  };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const refusal = (code: string, status: number) =>
  json({ error: { code, message: `the deployment says ${code}` } }, status);

describe("the SkillCDN source", () => {
  it("opens a pack at the deployment and reads what the address serves, with the token as the bearer and no redirect followed", async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    const { source: packs } = source(async (url, init) => {
      sent.push({ url, init });
      return json(READY);
    });
    const pack = packs.open(ADDRESS, "scdn_repo_x");
    expect(pack?.location).toEqual({ kind: "deployment", url: "https://skillcdn.test" });
    const mount = await pack?.mount();
    expect(sent[0]?.url).toBe("https://skillcdn.test/api/v1/mounts/gh/acme/skills");
    const headers = new Headers(sent[0]?.init.headers);
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("user-agent")).toBe("console-test");
    expect(headers.get("authorization")).toBe("Bearer scdn_repo_x");
    expect(sent[0]?.init.redirect).toBe("error");
    // The answer as the deployment gave it, parsed with the contracts of the main repository.
    expect(mount?.index.status).toBe("ready");
    expect(mount?.index.status === "ready" ? mount.index.skills[0]?.path : undefined).toBe(
      "skills/release-notes/SKILL.md",
    );
    // Without a token, as nobody.
    const anyone = packs.open(ADDRESS);
    await anyone?.mount();
    expect(new Headers(sent[1]?.init.headers).has("authorization")).toBe(false);
  });

  it("asks the five routes with their queries", async () => {
    const urls: string[] = [];
    const { source: packs } = source(async (url) => {
      urls.push(url.replace("https://skillcdn.test", ""));
      if (url.includes("/api/v1/files/")) {
        return json({ kind: "directory", path: "docs", entries: [], truncated: false });
      }
      if (url.includes("/api/v1/mounts/")) {
        return json(READY);
      }
      return json({ status: "indexing" });
    });
    const pack = packs.open(ADDRESS);
    if (pack === undefined) {
      throw new Error("the deployment serves every address");
    }
    await pack.mount();
    expect(await pack.browse({ path: "docs", cursor: "c", limit: 5 })).toEqual({
      status: "indexing",
    });
    expect(await pack.find({ query: "release notes", path: "docs", limit: 3 })).toEqual({
      status: "indexing",
    });
    expect(await pack.skill("skills/release-notes/SKILL.md", "two")).toEqual({
      status: "indexing",
    });
    expect(await pack.file({ path: "docs", offset: 7, limit: 100 })).toMatchObject({
      kind: "directory",
      path: "docs",
    });
    expect(urls).toEqual([
      "/api/v1/mounts/gh/acme/skills",
      "/api/v1/browse/gh/acme/skills?path=docs&cursor=c&limit=5",
      "/api/v1/find/gh/acme/skills?query=release+notes&path=docs&limit=3",
      "/api/v1/skills/gh/acme/skills?path=skills%2Frelease-notes%2FSKILL.md&cursor=two",
      "/api/v1/files/gh/acme/skills?path=docs&offset=7&limit=100",
    ]);
  });

  it("says what the deployment refused as a PackError with the code it gave, and what went wrong on the way as the client's own", async () => {
    const failing = async (answer: () => Response | Promise<Response>) => {
      const { source: packs, logs } = source(async () => answer());
      const pack = packs.open(ADDRESS, "scdn_repo_x");
      try {
        await pack?.mount();
      } catch (error) {
        return { error, logs };
      }
      throw new Error("the read should have failed");
    };
    const notThere = await failing(() => refusal("mount.repo_not_found", 404));
    expect(notThere.error).toBeInstanceOf(PackError);
    expect(notThere.error).toMatchObject({ status: 404, code: "mount.repo_not_found" });
    expect(notThere.logs).toEqual([]);
    const badToken = await failing(() => refusal("auth.invalid_token", 401));
    expect(badToken.error).toMatchObject({ status: 401, code: "auth.invalid_token" });
    const hostAway = await failing(() =>
      json({ error: { code: "host.unavailable", message: "later" } }, 503, {
        "retry-after": "30",
      }),
    );
    expect(hostAway.error).toMatchObject({ status: 503, code: "host.unavailable" });
    const tooLarge = await failing(() =>
      json(
        {
          error: {
            code: "file.too_large",
            message: "elsewhere",
            sourceUrl: "https://host.example/raw/big.md",
          },
        },
        413,
      ),
    );
    expect(tooLarge.error).toMatchObject({
      status: 413,
      code: "file.too_large",
      sourceUrl: "https://host.example/raw/big.md",
    });
    // No answer at all, and an answer in a shape the client does not read: the client's own
    // codes, and a line in the log, since the deployment is the console's to watch.
    const unreachable = await failing(() => {
      throw new TypeError("fetch failed");
    });
    expect(unreachable.error).toMatchObject({ status: 0, code: "network" });
    expect(unreachable.logs.map((line) => line.msg)).toEqual([
      "the SkillCDN deployment could not be read",
    ]);
    const odd = await failing(() => json({ hello: "world" }));
    expect(odd.error).toMatchObject({ status: 200, code: "invalid_response" });
    const html = await failing(
      () => new Response("<html>", { status: 404, headers: { "content-type": "text/html" } }),
    );
    expect(html.error).toMatchObject({ status: 404, code: "invalid_response" });
  });
});
