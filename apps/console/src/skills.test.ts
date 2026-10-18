import {
  formatAddress,
  parseAddress,
  type RestBrowse,
  type RestFile,
  type RestFind,
  type RestMount,
  type RestSkill,
} from "@skillcdn/core";
import { describe, expect, it } from "vitest";
import { type Pack, PackError, type PackSource } from "./ports/skill-source.js";
import { failureOf, Skills } from "./skills.js";

const addressOf = (text: string) => {
  const parsed = parseAddress(text);
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  return parsed.value;
};
const ADDRESS = addressOf("/gh/Acme/skills@v1");
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

/** A mount overview as a pack answers one, with the parts the console reads filled in. */
function mountOf(address: string, index: RestMount["index"]): RestMount {
  const parsed = addressOf(address);
  return {
    address,
    repository: {
      host: parsed.host,
      owner: parsed.owner,
      name: parsed.repo,
      defaultBranch: "main",
      description: null,
      avatar: "https://avatars.example/acme.png",
    },
    ref: parsed.ref?.kind === "name" ? parsed.ref.name : null,
    pinned: false,
    commit: COMMIT,
    path: parsed.path,
    verified: false,
    image: null,
    index,
  };
}

const READY: RestMount["index"] = {
  status: "ready",
  truncated: false,
  manifest: null,
  skillCount: 1,
  documentCount: 0,
  skills: [
    {
      path: "review/SKILL.md",
      name: "review",
      directory: "review",
      description: "Reviews a change.",
      warnings: [],
      translations: {},
    },
  ],
  documents: [],
  diagnostics: [],
};

const unasked = (): never => {
  throw new Error("not asked");
};

/** A source whose packs answer the mount from a queue, slowly enough for two readers to overlap, and count. */
function sourceOf(
  answers: (RestMount["index"] | PackError)[],
  kind: "deployment" | "directory" = "deployment",
) {
  let calls = 0;
  const opened: { readonly address: string; readonly token: string | undefined }[] = [];
  const source: PackSource = {
    open(address, token) {
      const canonical = formatAddress(address);
      opened.push({ address: canonical, token });
      return {
        address,
        location:
          kind === "deployment"
            ? { kind: "deployment", url: "https://skillcdn.test" }
            : { kind: "directory" },
        async mount() {
          calls += 1;
          await new Promise((resolve) => setTimeout(resolve, 10));
          const next = answers.shift();
          if (next === undefined) {
            throw new PackError(0, "network", "The server could not be reached.");
          }
          if (next instanceof PackError) {
            throw next;
          }
          return mountOf(canonical, next);
        },
        browse: unasked,
        find: unasked,
        skill: unasked,
        file: unasked,
      };
    },
  };
  return { source, calls: () => calls, opened };
}

describe("the skills of the board", () => {
  it("say there are none without an address, and ask nobody", async () => {
    const { source, calls } = sourceOf([READY]);
    const skills = new Skills({
      config: { source: "https://skillcdn.test", address: undefined },
      deployment: source,
      clock: { now: () => new Date(0) },
    });
    expect(await skills.read(undefined)).toEqual({
      address: null,
      source: "https://skillcdn.test",
      page: null,
      status: "none",
      refusal: null,
      items: [],
      mount: null,
    });
    expect(calls()).toBe(0);
  });

  it("name each skill's page and URI from the canonical address, carry the answer, hold it for a while, share one read, and ask again at once after a failure to reach", async () => {
    let now = 0;
    const { source, calls } = sourceOf([
      READY,
      new PackError(0, "network", "The server could not be reached."),
      { status: "indexing" },
    ]);
    const skills = new Skills({
      config: { source: "https://skillcdn.test", address: ADDRESS },
      deployment: source,
      clock: { now: () => new Date(now) },
      cacheMs: 1000,
    });
    const [first, second] = await Promise.all([skills.read(undefined), skills.read(undefined)]);
    expect(first).toMatchObject({
      address: "/gh/acme/skills@v1",
      source: "https://skillcdn.test",
      page: "https://skillcdn.test/gh/acme/skills@v1",
      status: "ready",
      refusal: null,
      pack: { name: "skills", description: null, language: null },
      counts: { skills: 1, documents: 0 },
      items: [
        {
          name: "review",
          description: "Reviews a change.",
          directory: "review",
          path: "review/SKILL.md",
          page: "https://skillcdn.test/gh/acme/skills@v1?skill=review%2FSKILL.md",
          uri: "skill://gh/acme/skills/review/SKILL.md",
          translations: {},
        },
      ],
    });
    // What the pack answered travels with the listing, for a program that renders it.
    expect(first.mount?.commit).toBe(COMMIT);
    expect(second).toBe(first);
    expect(calls()).toBe(1);
    now = 999;
    expect(await skills.read(undefined)).toBe(first);
    expect(calls()).toBe(1);
    now = 1000;
    const down = await skills.read(undefined);
    expect(down).toMatchObject({ status: "unavailable", items: [], mount: null });
    expect(down.refusal).toEqual({
      code: "network",
      message: "The server could not be reached.",
      sourceUrl: null,
      directories: [],
    });
    expect(calls()).toBe(2);
    // A pack that could not be reached is asked again at once, not in a while.
    const indexing = await skills.read(undefined);
    expect(indexing).toMatchObject({ status: "indexing", items: [] });
    expect(indexing.mount?.index.status).toBe("indexing");
    expect(calls()).toBe(3);
    expect((await skills.read(undefined)).status).toBe("indexing");
    expect(calls()).toBe(3);
  });

  it("read a project's own address over the organization's, each held on its own", async () => {
    const { source, calls } = sourceOf([READY, { status: "indexing" }]);
    const skills = new Skills({
      config: { source: "https://skillcdn.test", address: ADDRESS },
      deployment: source,
      clock: { now: () => new Date(0) },
    });
    const own = await skills.read("/gh/acme/playbooks");
    expect(own).toMatchObject({ address: "/gh/acme/playbooks", status: "ready" });
    expect(own.items[0]?.uri).toBe("skill://gh/acme/playbooks/review/SKILL.md");
    const organization = await skills.read(undefined);
    expect(organization).toMatchObject({ address: "/gh/acme/skills@v1", status: "indexing" });
    expect(calls()).toBe(2);
    expect(await skills.read("/gh/acme/playbooks")).toBe(own);
    expect(calls()).toBe(2);
    // An address that is not one, which a project should never hold, is none at all.
    expect((await skills.read("not an address")).status).toBe("none");
  });

  it("read a pack with a token every time, holding nothing, and pass each read on as the pack answered it (ADR-0028)", async () => {
    let listed = 0;
    const tokens: (string | undefined)[] = [];
    const page = (cursor: string | undefined): RestSkill => ({
      status: "ready",
      commit: COMMIT,
      skill: {
        path: "review/SKILL.md",
        ruleChain: [{ path: "SKILLCDN.md", body: "Be kind.", truncated: false }],
        references: [],
        complete: cursor !== undefined,
        nextCursor: cursor === undefined ? "two" : null,
        includedContents: [],
        name: "review",
        directory: "review",
        description: "Reviews a change.",
        license: "MIT",
        compatibility: null,
        allowedTools: null,
        metadata: {},
        body: cursor ?? "start",
        files: ["review/guide.md"],
        filesTruncated: false,
        included: [],
        warnings: [],
        translations: {},
        rules: { path: "SKILLCDN.md", body: "Be kind.", truncated: false },
      },
    });
    const file: RestFile = {
      kind: "file",
      commit: COMMIT,
      path: "review/guide.md",
      content: "x",
      offset: 0,
      nextOffset: null,
      totalLength: 1,
    };
    const folder: RestBrowse = {
      status: "ready",
      commit: COMMIT,
      path: "docs",
      entries: [],
      nextCursor: null,
    };
    const found: RestFind = { status: "indexing" };
    const source: PackSource = {
      open(address, token): Pack {
        tokens.push(token);
        return {
          address,
          location: { kind: "deployment", url: "https://skillcdn.test" },
          async mount() {
            listed += 1;
            return mountOf(formatAddress(address), READY);
          },
          browse: async () => folder,
          find: async () => found,
          skill: async (path, cursor) => {
            if (path !== "review/SKILL.md") {
              throw new PackError(
                404,
                "skill.not_found",
                "No skill at that SKILL.md path in this mount.",
              );
            }
            return page(cursor);
          },
          file: async () => file,
        };
      },
    };
    const skills = new Skills({
      config: { source: "https://skillcdn.test", address: ADDRESS },
      deployment: source,
      clock: { now: () => new Date(0) },
    });
    await skills.read(undefined, "scdn_repo_x");
    await skills.read(undefined, "scdn_repo_x");
    expect(listed).toBe(2);
    await skills.read(undefined);
    await skills.read(undefined);
    expect(listed).toBe(3);
    expect(tokens).toEqual(["scdn_repo_x", "scdn_repo_x", undefined]);
    const loaded = await skills.load(
      "/gh/acme/playbooks",
      "review/SKILL.md",
      undefined,
      "scdn_repo_x",
    );
    expect(loaded).toEqual({
      address: "/gh/acme/playbooks",
      source: "https://skillcdn.test",
      page: "https://skillcdn.test/gh/acme/playbooks",
      status: "ready",
      refusal: null,
      read: page(undefined),
    });
    expect(tokens[tokens.length - 1]).toBe("scdn_repo_x");
    expect((await skills.load(undefined, "review/SKILL.md", "two")).read).toEqual(page("two"));
    // What the pack refuses is the status, with the pack's own words beside it.
    const missing = await skills.load(undefined, "nothing/SKILL.md", undefined);
    expect(missing).toMatchObject({ status: "not_found", read: null });
    expect(missing.refusal).toEqual({
      code: "skill.not_found",
      message: "No skill at that SKILL.md path in this mount.",
      sourceUrl: null,
      directories: [],
    });
    expect((await skills.file(undefined, { path: "review/guide.md" })).read).toEqual(file);
    expect((await skills.browse(undefined, { path: "docs" })).read).toEqual(folder);
    // An index that is not there to read from is the status, and nothing was read.
    expect(await skills.find(undefined, { query: "review" })).toMatchObject({
      status: "indexing",
      refusal: null,
      read: null,
    });
  });

  it("read a local address from the directory the console was given, without a token and with no page, and at the deployment without one (ADR-0031)", async () => {
    const directory = sourceOf([READY, READY], "directory");
    const deployment = sourceOf([READY]);
    const skills = new Skills({
      config: { source: "https://skillcdn.test", address: undefined },
      deployment: deployment.source,
      directory: directory.source,
      clock: { now: () => new Date(0) },
    });
    const local = await skills.read("/local/acme/skills", "scdn_repo_x");
    expect(local).toMatchObject({
      address: "/local/acme/skills",
      source: null,
      page: null,
      status: "ready",
      items: [
        {
          path: "review/SKILL.md",
          page: null,
          uri: "skill://local/acme/skills/review/SKILL.md",
        },
      ],
    });
    expect(directory.opened).toEqual([{ address: "/local/acme/skills", token: undefined }]);
    expect(deployment.opened).toEqual([]);
    // Without a directory to read it from, a local address is asked of the deployment, which
    // may be a pack served from a machine by the skillcdn command.
    const elsewhere = new Skills({
      config: { source: "https://skillcdn.test", address: undefined },
      deployment: deployment.source,
      clock: { now: () => new Date(0) },
    });
    expect(await elsewhere.read("/local/acme/skills")).toMatchObject({
      status: "ready",
      source: "https://skillcdn.test",
      page: "https://skillcdn.test/local/acme/skills",
    });
    expect(deployment.opened).toEqual([{ address: "/local/acme/skills", token: undefined }]);
  });

  it("say what a refusal of the pack means to the board", () => {
    const of = (status: number, code: string, extra = {}) =>
      failureOf(new PackError(status, code, "why", extra));
    expect(of(401, "invalid_response").status).toBe("token_invalid");
    expect(of(401, "auth.invalid_token").status).toBe("token_invalid");
    expect(of(503, "index.indexing").status).toBe("indexing");
    expect(of(503, "index.failed").status).toBe("failed");
    expect(of(404, "mount.repo_not_found").status).toBe("not_found");
    expect(of(403, "file.not_served").status).toBe("not_found");
    expect(of(400, "request.invalid").status).toBe("not_found");
    expect(of(409, "skill.ambiguous", { directories: ["a", "b"] })).toEqual({
      status: "not_found",
      refusal: {
        code: "skill.ambiguous",
        message: "why",
        sourceUrl: null,
        directories: ["a", "b"],
      },
    });
    expect(of(413, "file.too_large", { sourceUrl: "https://host.example/raw" })).toEqual({
      status: "failed",
      refusal: {
        code: "file.too_large",
        message: "why",
        sourceUrl: "https://host.example/raw",
        directories: [],
      },
    });
    expect(of(415, "file.not_text").status).toBe("failed");
    expect(of(0, "network").status).toBe("unavailable");
    expect(of(500, "invalid_response").status).toBe("unavailable");
    expect(of(503, "host.unavailable").status).toBe("unavailable");
  });
});
