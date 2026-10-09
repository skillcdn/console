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
    expect(await skills.read()).toEqual({
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
    const [first, second] = await Promise.all([skills.read(), skills.read()]);
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
    expect(await skills.read()).toBe(first);
    expect(calls()).toBe(1);
    now = 1000;
    expect((await skills.read()).status).toBe("unavailable");
    expect(calls()).toBe(2);
    // A deployment that could not be reached is asked again at once, not in a while.
    expect((await skills.read()).status).toBe("indexing");
    expect(calls()).toBe(3);
    expect((await skills.read()).status).toBe("indexing");
    expect(calls()).toBe(3);
  });
});
