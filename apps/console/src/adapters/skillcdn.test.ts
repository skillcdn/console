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
    // No manifest and no README: the pack is named after the repository, and says nothing more.
    expect(listing.pack).toEqual({ name: "skills", description: undefined, language: undefined });
    expect(listing.counts).toEqual({ skills: 2, documents: 0 });
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
    // Headers in time, the body not: the deployment stopped answering, which is unavailable too.
    const cut = source(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("{"));
              controller.error(new DOMException("Aborted due to timeout", "TimeoutError"));
            },
          }),
          { status: 200 },
        ),
    );
    expect((await cut.source.list(ADDRESS)).status).toBe("unavailable");
    expect(cut.logs.at(-1)?.msg).toBe("the SkillCDN deployment stopped answering");
  });
});

describe("the SkillCDN source, reading the pack (ADR-0028)", () => {
  const skill = {
    status: "ready",
    skill: {
      path: "review/SKILL.md",
      name: "review",
      directory: "review",
      description: "Reviews a change.",
      license: "MIT",
      compatibility: null,
      allowedTools: null,
      metadata: {},
      body: "Read the diff.",
      files: ["review/guide.md"],
      filesTruncated: false,
      included: ["review/checklist.md"],
      warnings: [],
      translations: {},
      rules: null,
      ruleChain: [{ path: "SKILLCDN.md", body: "Be kind.", truncated: false }],
      includedContents: [{ path: "review/checklist.md", content: "- tests", truncated: false }],
      references: [{ href: "guide.md", path: "review/guide.md", status: "available" }],
      complete: false,
      nextCursor: "two",
      serving: {
        license: { kind: "permissive", name: "MIT", source: null },
        full: true,
        sourceUrl: "https://github.com/acme/skills/blob/main/review/SKILL.md",
      },
    },
  };

  it("sends the pack token as the bearer and nowhere else, and reads a skill as load_skill lays it out", async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    const { source: skills } = source(async (url, init) => {
      sent.push({ url, init });
      return json(skill);
    });
    const loaded = await skills.load(ADDRESS, "review/SKILL.md", "one", "scdn_repo_x");
    expect(sent[0]?.url).toBe(
      "https://skillcdn.test/api/v1/skills/gh/acme/skills?path=review%2FSKILL.md&cursor=one",
    );
    expect(new Headers(sent[0]?.init.headers).get("authorization")).toBe("Bearer scdn_repo_x");
    expect(sent[0]?.init.redirect).toBe("manual");
    expect(loaded).toEqual({
      status: "ready",
      skill: {
        path: "review/SKILL.md",
        directory: "review",
        name: "review",
        description: "Reviews a change.",
        rules: [{ path: "SKILLCDN.md", body: "Be kind.", truncated: false }],
        body: "Read the diff.",
        included: [{ path: "review/checklist.md", body: "- tests", truncated: false }],
        files: ["review/guide.md"],
        references: [{ path: "review/guide.md", status: "available" }],
        complete: false,
        nextCursor: "two",
        serving: {
          full: true,
          license: "MIT",
          sourceUrl: "https://github.com/acme/skills/blob/main/review/SKILL.md",
        },
        warnings: [],
      },
    });
    // Without a token nothing is sent as one; the listing carries a token the same way.
    const bare = source(async (url, init) => {
      sent.push({ url, init });
      return json(READY);
    });
    await bare.source.list(ADDRESS);
    expect(new Headers(sent.at(-1)?.init.headers).has("authorization")).toBe(false);
    await bare.source.list(ADDRESS, "scdn_repo_x");
    expect(new Headers(sent.at(-1)?.init.headers).get("authorization")).toBe("Bearer scdn_repo_x");
  });

  it("says when the token is no good and when a file is not carried, and reads a file or a folder", async () => {
    const refused = source(async () =>
      json({ error: { code: "auth.invalid_token", message: "no" } }, 401),
    );
    expect(await refused.source.list(ADDRESS, "scdn_repo_old")).toEqual({
      status: "token_invalid",
      skills: [],
    });
    expect(
      await refused.source.load(ADDRESS, "review/SKILL.md", undefined, "scdn_repo_old"),
    ).toEqual({ status: "token_invalid" });
    const waiting = source(async () =>
      json({ error: { code: "index.indexing", message: "wait" } }, 503),
    );
    expect(await waiting.source.read(ADDRESS, "review/guide.md", {})).toEqual({
      status: "indexing",
    });
    const big = source(async () => json({ error: { code: "file.too_large", message: "no" } }, 413));
    expect(await big.source.read(ADDRESS, "review/big.bin", {})).toEqual({ status: "failed" });
    const sent: string[] = [];
    const file = source(async (url) => {
      sent.push(url);
      return json({
        kind: "file",
        path: "review/guide.md",
        content: "How to",
        offset: 0,
        nextOffset: 6,
        totalLength: 14,
      });
    });
    expect(await file.source.read(ADDRESS, "review/guide.md", { offset: 0, limit: 6 })).toEqual({
      status: "ready",
      file: {
        path: "review/guide.md",
        content: "How to",
        offset: 0,
        nextOffset: 6,
        totalLength: 14,
      },
      folder: undefined,
    });
    expect(sent[0]).toBe(
      "https://skillcdn.test/api/v1/files/gh/acme/skills?path=review%2Fguide.md&offset=0&limit=6",
    );
    const folder = source(async () =>
      json({
        kind: "directory",
        path: "review",
        entries: [{ path: "review/SKILL.md", kind: "file", size: 120 }],
        truncated: false,
      }),
    );
    expect(await folder.source.read(ADDRESS, "review", {})).toEqual({
      status: "ready",
      file: undefined,
      folder: {
        path: "review",
        entries: [{ path: "review/SKILL.md", kind: "file", size: 120 }],
        truncated: false,
      },
    });
    const odd = source(async () => json({ status: "ready", skill: { name: 1 } }));
    expect(await odd.source.load(ADDRESS, "review/SKILL.md", undefined)).toEqual({
      status: "unavailable",
    });
  });

  it("browses a folder as browse_repo lays it out, and searches as search_repo does, the token as the bearer", async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    const { source: skills } = source(async (url, init) => {
      sent.push({ url, init });
      return url.includes("/browse/")
        ? json({
            status: "ready",
            commit: "0123456789abcdef0123456789abcdef01234567",
            path: "docs",
            overview: {
              path: "docs/README.md",
              title: "Documentation",
              description: "How the docs are organized.",
            },
            entries: [
              {
                kind: "directory",
                path: "docs/adr",
                name: "Architecture Decision Records",
                description: null,
                skillCount: 0,
                documentCount: 54,
                size: null,
                manifestPath: null,
                language: null,
                overviewPath: "docs/adr/README.md",
              },
              {
                kind: "skill",
                path: "docs/review/SKILL.md",
                name: "review",
                description: "Reviews a change.",
                skillCount: 0,
                documentCount: 0,
                size: null,
                manifestPath: null,
                language: null,
                license: { kind: "permissive", name: "MIT", source: null },
                describedOnly: false,
              },
              {
                kind: "file",
                path: "docs/architecture.md",
                name: "Architecture",
                description: null,
                skillCount: 0,
                documentCount: 0,
                size: 1234,
                manifestPath: null,
                language: null,
              },
            ],
            nextCursor: "more",
          })
        : json({
            status: "ready",
            query: "review",
            commit: "0123456789abcdef0123456789abcdef01234567",
            path: "docs",
            totals: { skills: 1, documents: 1 },
            items: [
              {
                kind: "skill",
                path: "docs/review/SKILL.md",
                name: "review",
                directory: "docs/review",
                description: "Reviews a change.",
                translations: {},
                files: [{ path: "docs/review/guide.md", title: "Guide", summary: null }],
                moreFiles: 2,
                license: { kind: "permissive", name: "MIT", source: null },
                describedOnly: false,
              },
              {
                kind: "document",
                path: "docs/architecture.md",
                title: "Architecture",
                summary: "Four properties.",
                skillDirectory: null,
              },
            ],
            nextCursor: null,
          });
    });
    const browsed = await skills.browse(
      ADDRESS,
      { path: "docs", cursor: "c1", limit: 50 },
      "scdn_repo_x",
    );
    expect(sent[0]?.url).toBe(
      "https://skillcdn.test/api/v1/browse/gh/acme/skills?path=docs&cursor=c1&limit=50",
    );
    expect(new Headers(sent[0]?.init.headers).get("authorization")).toBe("Bearer scdn_repo_x");
    expect(browsed).toEqual({
      status: "ready",
      folder: {
        path: "docs",
        overview: {
          path: "docs/README.md",
          title: "Documentation",
          description: "How the docs are organized.",
        },
        entries: [
          {
            kind: "directory",
            path: "docs/adr",
            name: "Architecture Decision Records",
            description: undefined,
            skillCount: 0,
            documentCount: 54,
            size: undefined,
            overviewPath: "docs/adr/README.md",
            license: undefined,
            describedOnly: false,
          },
          {
            kind: "skill",
            path: "docs/review/SKILL.md",
            name: "review",
            description: "Reviews a change.",
            skillCount: 0,
            documentCount: 0,
            size: undefined,
            overviewPath: undefined,
            license: "MIT",
            describedOnly: false,
          },
          {
            kind: "file",
            path: "docs/architecture.md",
            name: "Architecture",
            description: undefined,
            skillCount: 0,
            documentCount: 0,
            size: 1234,
            overviewPath: undefined,
            license: undefined,
            describedOnly: false,
          },
        ],
        nextCursor: "more",
      },
    });
    const found = await skills.find(ADDRESS, { query: "review", path: "docs", limit: 10 });
    expect(sent[1]?.url).toBe(
      "https://skillcdn.test/api/v1/find/gh/acme/skills?query=review&path=docs&limit=10",
    );
    expect(new Headers(sent[1]?.init.headers).has("authorization")).toBe(false);
    expect(found).toEqual({
      status: "ready",
      found: {
        query: "review",
        path: "docs",
        items: [
          {
            kind: "skill",
            path: "docs/review/SKILL.md",
            directory: "docs/review",
            name: "review",
            description: "Reviews a change.",
            translations: {},
            files: [{ path: "docs/review/guide.md", title: "Guide", summary: undefined }],
            moreFiles: 2,
            license: "MIT",
            describedOnly: false,
          },
          {
            kind: "document",
            path: "docs/architecture.md",
            title: "Architecture",
            summary: "Four properties.",
            skillDirectory: undefined,
          },
        ],
        nextCursor: undefined,
      },
    });
    // Still indexing, refused, or answered in a shape that is not one: a status, never a throw.
    const waiting = source(async () => json({ status: "indexing" }));
    expect(await waiting.source.browse(ADDRESS, {})).toEqual({ status: "indexing" });
    expect(await waiting.source.find(ADDRESS, { query: "x" })).toEqual({ status: "indexing" });
    const refused = source(async () =>
      json({ error: { code: "auth.invalid_token", message: "no" } }, 401),
    );
    expect(await refused.source.find(ADDRESS, { query: "x" }, "scdn_repo_old")).toEqual({
      status: "token_invalid",
    });
    const odd = source(async () => json({ status: "ready", entries: "no" }));
    expect(await odd.source.browse(ADDRESS, {})).toEqual({ status: "unavailable" });
    // A path the deployment refuses as not one is nothing to read, not a deployment out of reach.
    const refusedPath = source(async () =>
      json({ error: { code: "request.invalid", message: "path" } }, 400),
    );
    expect(await refusedPath.source.browse(ADDRESS, { path: "C:/Program Files/Git" })).toEqual({
      status: "not_found",
    });
  });
});
