import { parseAddress } from "@skillcdn/core";
import { describe, expect, it } from "vitest";
import type { SkillListing, SkillSource } from "./ports/skill-source.js";
import { Skills } from "./skills.js";

const ADDRESS = (() => {
  const parsed = parseAddress("/gh/Acme/skills@v1");
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  return parsed.value;
})();

const READY: SkillListing = {
  status: "ready",
  skills: [
    {
      name: "review",
      description: "Reviews a change.",
      directory: "review",
      path: "review/SKILL.md",
      translations: {},
    },
  ],
};

/** A source that answers from a queue, slowly enough for two readers to overlap, and counts. */
function sourceOf(answers: SkillListing[]) {
  let calls = 0;
  const source: SkillSource = {
    load: async () => ({ status: "unavailable" }),
    read: async () => ({ status: "unavailable" }),
    async list() {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return answers.shift() ?? { status: "unavailable", skills: [] };
    },
  };
  return { source, calls: () => calls };
}

describe("the skills of the board", () => {
  it("say there are none without an address, and ask nobody", async () => {
    const { source, calls } = sourceOf([READY]);
    const skills = new Skills({
      config: { source: "https://skillcdn.test", address: undefined },
      source,
      clock: { now: () => new Date(0) },
    });
    expect(await skills.read(undefined)).toEqual({
      address: null,
      source: "https://skillcdn.test",
      page: null,
      status: "none",
      items: [],
    });
    expect(calls()).toBe(0);
  });

  it("name each skill's page and URI from the canonical address, hold an answer for a while, share one read, and ask again at once after a failure to reach", async () => {
    let now = 0;
    const { source, calls } = sourceOf([
      READY,
      { status: "unavailable", skills: [] },
      { status: "indexing", skills: [] },
    ]);
    const skills = new Skills({
      config: { source: "https://skillcdn.test", address: ADDRESS },
      source,
      clock: { now: () => new Date(now) },
      cacheMs: 1000,
    });
    const [first, second] = await Promise.all([skills.read(undefined), skills.read(undefined)]);
    expect(first).toEqual({
      address: "/gh/acme/skills@v1",
      source: "https://skillcdn.test",
      page: "https://skillcdn.test/gh/acme/skills@v1",
      status: "ready",
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
    expect(second).toBe(first);
    expect(calls()).toBe(1);
    now = 999;
    expect(await skills.read(undefined)).toBe(first);
    expect(calls()).toBe(1);
    now = 1000;
    expect((await skills.read(undefined)).status).toBe("unavailable");
    expect(calls()).toBe(2);
    // A deployment that could not be reached is asked again at once, not in a while.
    expect((await skills.read(undefined)).status).toBe("indexing");
    expect(calls()).toBe(3);
    expect((await skills.read(undefined)).status).toBe("indexing");
    expect(calls()).toBe(3);
  });

  it("read a project's own address over the organization's, each held on its own", async () => {
    const { source, calls } = sourceOf([READY, { status: "indexing", skills: [] }]);
    const skills = new Skills({
      config: { source: "https://skillcdn.test", address: ADDRESS },
      source,
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

  it("read a pack with a token every time, holding nothing, and shape a skill and a file (ADR-0028)", async () => {
    let listed = 0;
    const source: SkillSource = {
      async list() {
        listed += 1;
        return READY;
      },
      async load(_address, path, cursor) {
        return {
          status: "ready",
          skill: {
            path,
            directory: "review",
            name: "review",
            description: "Reviews a change.",
            rules: [],
            body: cursor ?? "start",
            included: [],
            files: [],
            references: [],
            complete: cursor !== undefined,
            nextCursor: cursor === undefined ? "two" : undefined,
            serving: { full: true, license: undefined, sourceUrl: undefined },
            warnings: [],
          },
        };
      },
      async read(_address, path) {
        return {
          status: "ready",
          file: { path, content: "x", offset: 0, nextOffset: undefined, totalLength: 1 },
          folder: undefined,
        };
      },
    };
    const skills = new Skills({
      config: { source: "https://skillcdn.test", address: ADDRESS },
      source,
      clock: { now: () => new Date(0) },
    });
    await skills.read(undefined, "scdn_repo_x");
    await skills.read(undefined, "scdn_repo_x");
    expect(listed).toBe(2);
    await skills.read(undefined);
    await skills.read(undefined);
    expect(listed).toBe(3);
    const loaded = await skills.load(
      "/gh/acme/playbooks",
      "review/SKILL.md",
      undefined,
      "scdn_repo_x",
    );
    expect(loaded).toMatchObject({
      address: "/gh/acme/playbooks",
      page: "https://skillcdn.test/gh/acme/playbooks",
      status: "ready",
    });
    expect(loaded.skill).toMatchObject({
      body: "start",
      nextCursor: "two",
      complete: false,
      serving: { full: true, license: null, sourceUrl: null },
    });
    const file = await skills.file(undefined, "review/guide.md", {}, "scdn_repo_x");
    expect(file).toMatchObject({
      address: "/gh/acme/skills@v1",
      status: "ready",
      file: { content: "x", nextOffset: null },
      folder: null,
    });
    expect(await skills.file("not an address", "x", {})).toMatchObject({
      status: "none",
      file: null,
      folder: null,
    });
  });
});
