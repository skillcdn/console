import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAddress } from "@skillcdn/core";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PackError } from "../ports/skill-source.js";
import { createDirectorySource } from "./directory-packs.js";

// An invented pack in a directory of this run's own: a manifest with rules and a document
// directory, a skill with a file of its own, and a document outside the skills.

const addressOf = (text: string) => {
  const parsed = parseAddress(text);
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  return parsed.value;
};

let root: string;

async function writePack(directory: string): Promise<void> {
  await mkdir(join(directory, "review"), { recursive: true });
  await mkdir(join(directory, "docs"), { recursive: true });
  await writeFile(
    join(directory, "SKILLCDN.md"),
    "---\nname: Acme\ndescription: What Acme does, as skills.\ndocuments:\n  - docs\n---\nBe kind.\n",
  );
  await writeFile(
    join(directory, "review", "SKILL.md"),
    "---\nname: review\ndescription: Reviews a change.\n---\nRead the diff, then say so.\n",
  );
  await writeFile(join(directory, "review", "guide.md"), "# Reviewing\n\nHow to review.\n");
  await writeFile(join(directory, "docs", "handbook.md"), "# Handbook\n\nWelcome aboard.\n");
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "console-packs-"));
  await writePack(join(root, "acme", "skills"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function sourceAt(now: () => number, cacheMs?: number) {
  return createDirectorySource({
    root,
    clock: { now: () => new Date(now()) },
    logger: pino({ level: "silent" }),
    cacheMs,
  });
}

const failure = async (read: Promise<unknown>) => {
  try {
    await read;
  } catch (error) {
    return error;
  }
  throw new Error("the read should have failed");
};

describe("packs served from this machine (ADR-0031)", () => {
  it("serve the directory under the root as the pack of a local address, verified, with the reads of a deployment", async () => {
    const pack = sourceAt(() => 0).open(addressOf("/local/acme/skills"));
    if (pack === undefined) {
      throw new Error("a local address is served from the directory");
    }
    expect(pack.location).toEqual({ kind: "directory" });
    const mount = await pack.mount();
    expect(mount).toMatchObject({
      address: "/local/acme/skills",
      repository: { host: "local", owner: "acme", name: "skills" },
      ref: null,
      commit: "0".repeat(40),
      path: "",
      verified: true,
    });
    expect(mount.index.status).toBe("ready");
    if (mount.index.status !== "ready") {
      return;
    }
    expect(mount.index.manifest).toMatchObject({
      name: "Acme",
      description: "What Acme does, as skills.",
    });
    expect(mount.index.skills.map((skill) => skill.path)).toEqual(["review/SKILL.md"]);
    expect(mount.index.documents.map((document) => document.path)).toEqual(["docs/handbook.md"]);
    expect(mount.index.skillCount).toBe(1);
    expect(mount.index.documentCount).toBe(1);

    const folder = await pack.browse({ path: "review" });
    expect(folder.status).toBe("ready");
    expect(folder.status === "ready" ? folder.entries.map((entry) => entry.path) : []).toEqual([
      "review/SKILL.md",
      "review/guide.md",
    ]);
    const found = await pack.find({ query: "review" });
    expect(found.status === "ready" ? found.items.map((item) => item.path) : []).toEqual([
      "review/SKILL.md",
    ]);
    const skill = await pack.skill("review/SKILL.md");
    expect(skill.status).toBe("ready");
    if (skill.status === "ready") {
      expect(skill.commit).toBe("0".repeat(40));
      expect(skill.skill.body).toContain("Read the diff, then say so.");
      expect(skill.skill.ruleChain?.map((rule) => rule.body)).toEqual(["Be kind."]);
      expect(skill.skill.files).toEqual(["review/guide.md"]);
      expect(skill.skill.complete).toBe(true);
      expect(skill.skill.serving?.full).toBe(true);
    }
    const file = await pack.file({ path: "review/guide.md" });
    expect(file).toMatchObject({
      kind: "file",
      path: "review/guide.md",
      content: "# Reviewing\n\nHow to review.\n",
    });
    const listing = await pack.file({ path: "review" });
    expect(listing.kind === "directory" ? listing.entries.map((entry) => entry.path) : []).toEqual([
      "review/SKILL.md",
      "review/guide.md",
    ]);
    // What the pack does not have, in the words of the API.
    expect(await failure(pack.file({ path: "nothing.md" }))).toMatchObject({
      status: 404,
      code: "file.not_found",
    });
    expect(await failure(pack.skill("nothing/SKILL.md"))).toMatchObject({
      status: 404,
      code: "skill.not_found",
    });
    expect(await failure(pack.browse({ path: "../elsewhere" }))).toBeInstanceOf(PackError);
  });

  it("serve a folder of the pack as a mount of its own", async () => {
    const pack = sourceAt(() => 0).open(addressOf("/local/acme/skills/review"));
    const mount = await pack?.mount();
    expect(mount).toMatchObject({ address: "/local/acme/skills/review", path: "review" });
    expect(
      mount?.index.status === "ready" ? mount.index.skills.map((s) => s.directory) : [],
    ).toEqual(["review"]);
    expect(mount?.index.status === "ready" ? mount.index.documentCount : -1).toBe(0);
  });

  it("answer nothing for an address of a git host, and not found for a pack that is not there, or a ref", async () => {
    const source = sourceAt(() => 0);
    expect(source.open(addressOf("/gh/acme/skills"))).toBeUndefined();
    const missing = source.open(addressOf("/local/acme/missing"));
    expect(await failure(missing?.mount() ?? Promise.reject(new Error("no pack")))).toMatchObject({
      status: 404,
      code: "mount.repo_not_found",
    });
    const ref = source.open(addressOf("/local/acme/skills@main"));
    expect(await failure(ref?.mount() ?? Promise.reject(new Error("no pack")))).toMatchObject({
      status: 404,
      code: "mount.ref_not_found",
    });
  });

  it("keep the index of a directory for a while, then read the directory again", async () => {
    const own = await mkdtemp(join(tmpdir(), "console-packs-"));
    try {
      await writePack(join(own, "acme", "skills"));
      let now = 0;
      const source = createDirectorySource({
        root: own,
        clock: { now: () => new Date(now) },
        logger: pino({ level: "silent" }),
        cacheMs: 1000,
      });
      const address = addressOf("/local/acme/skills");
      const first = await source.open(address)?.mount();
      expect(first?.index.status === "ready" ? first.index.skillCount : -1).toBe(1);
      await mkdir(join(own, "acme", "skills", "release-notes"), { recursive: true });
      await writeFile(
        join(own, "acme", "skills", "release-notes", "SKILL.md"),
        "---\nname: release-notes\ndescription: Writes the notes of a release.\n---\nList what changed.\n",
      );
      now = 999;
      const held = await source.open(address)?.mount();
      expect(held?.index.status === "ready" ? held.index.skillCount : -1).toBe(1);
      now = 1000;
      const again = await source.open(address)?.mount();
      expect(again?.index.status === "ready" ? again.index.skillCount : -1).toBe(2);
    } finally {
      await rm(own, { recursive: true, force: true });
    }
  });
});
