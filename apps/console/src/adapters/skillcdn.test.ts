import { parseAddress } from "@skillcdn/core";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createSkillCdnSource } from "./skillcdn.js";
import type { FetchLike } from "./upstream.js";

const ADDRESS = (() => {
  const parsed = parseAddress("/gh/acme/skills");
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  return parsed.value;
})();

/** A mount overview as the deployment answers one, with the parts the console reads filled in. */
function overview(index: unknown) {
  return {
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
    index,
  };
}

const READY = overview({
  status: "ready",
  truncated: false,
  manifest: null,
  skillCount: 2,
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
    {
      name: "review",
      directory: "review",
      description: "Reviews a change.",
      warnings: [],
      translations: {},
    },
  ],
  documents: [],
  diagnostics: [],
});

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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("the SkillCDN source", () => {
  it("reads the mount overview of the address, as JSON, and lists the skills with their paths", async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    const { source: skills } = source(async (url, init) => {
      sent.push({ url, init });
      return json(READY);
    });
    const listing = await skills.list(ADDRESS);
    expect(sent[0]?.url).toBe("https://skillcdn.test/api/v1/mounts/gh/acme/skills");
    expect(new Headers(sent[0]?.init.headers).get("accept")).toBe("application/json");
    expect(sent[0]?.init.redirect).toBe("manual");
    expect(listing.status).toBe("ready");
    expect(listing.skills).toEqual([
      {
        name: "release-notes",
        description: "Writes the notes of a release.",
        directory: "skills/release-notes",
        path: "skills/release-notes/SKILL.md",
        translations: { ko: { title: "릴리스 노트", description: null } },
      },
      {
        name: "review",
        description: "Reviews a change.",
        directory: "review",
        path: "review/SKILL.md",
        translations: {},
      },
    ]);
  });

  it("says when the deployment is still indexing, or could not", async () => {
    const indexing = source(async () => json(overview({ status: "indexing" })));
    expect(await indexing.source.list(ADDRESS)).toEqual({ status: "indexing", skills: [] });
    const failed = source(async () =>
      json(overview({ status: "failed", errorCode: "repo.unreadable" })),
    );
    expect(await failed.source.list(ADDRESS)).toEqual({ status: "failed", skills: [] });
  });

  it("says when the address is not served, and when the deployment cannot be read, without throwing", async () => {
    const missing = source(async () =>
      json({ error: { code: "mount.repo_not_found", message: "no" } }, 404),
    );
    expect((await missing.source.list(ADDRESS)).status).toBe("not_found");
    const refused = source(async () =>
      json({ error: { code: "mount.not_allowed", message: "no" } }, 403),
    );
    expect((await refused.source.list(ADDRESS)).status).toBe("not_found");
    const down = source(async () => {
      throw new TypeError("fetch failed");
    });
    expect((await down.source.list(ADDRESS)).status).toBe("unavailable");
    expect(down.logs[0]?.msg).toBe("the SkillCDN deployment could not be reached");
    const broken = source(async () => json({ error: { code: "x", message: "y" } }, 503));
    expect((await broken.source.list(ADDRESS)).status).toBe("unavailable");
    const html = source(async () => new Response("<html>", { status: 200 }));
    expect((await html.source.list(ADDRESS)).status).toBe("unavailable");
    const odd = source(async () => json({ address: 1 }));
    expect((await odd.source.list(ADDRESS)).status).toBe("unavailable");
    const long = source(async () => new Response("x".repeat(1024 * 1024 + 1), { status: 200 }));
    expect((await long.source.list(ADDRESS)).status).toBe("unavailable");
  });
});
