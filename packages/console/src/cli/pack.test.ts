import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PackError, readPack } from "@skillcdn/cli";
import { describe, expect, it } from "vitest";
import type { PackClient } from "../client.js";
import type { RestSkills } from "../schemas.js";
import { NO_LINE_TO_RUN } from "./command-words.js";
import { CONSOLE_WORDS, consolePack, PackRefusal, packWords, refusalWords } from "./pack.js";

// The pack the command makes of the console's answers (ADR-0124), by itself: what it hands the
// reads of the skillcdn command, and what it throws for the command to say.

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const AT = {
  address: "/gh/acme/skills",
  source: "https://skillcdn.test",
  page: "https://skillcdn.test/gh/acme/skills",
  status: "ready" as const,
  refusal: null,
};
const LISTING: RestSkills = {
  ...AT,
  items: [],
  mount: {
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
    commit: COMMIT,
    path: "",
    verified: false,
    image: null,
    index: {
      status: "ready",
      truncated: false,
      manifest: null,
      skillCount: 2,
      documentCount: 2,
      skills: [
        {
          path: "review/SKILL.md",
          name: "review",
          directory: "review",
          description: "Reviews a change.",
          warnings: [],
          translations: {},
        },
        // A skill at the root, whose answer left its path out.
        {
          name: "root",
          directory: "",
          description: "The root's own.",
          warnings: [],
          translations: {},
        },
      ],
      documents: [
        { path: "docs/README.md", title: "Documentation", summary: null },
        { path: "docs/guide.md", title: "Guide", summary: "How it is done." },
      ],
      diagnostics: [],
    },
  },
};

const refusedWith = (status: "not_found" | "failed" | "token_invalid", code: string) => ({
  ...AT,
  status,
  refusal: { code, message: `Said by the pack: ${code}.`, sourceUrl: null, directories: [] },
  read: null,
});

/** A console that answers nothing it is not told to: a read the test did not expect fails it. */
const reader = (reads: Partial<PackClient>): PackClient => {
  const unexpected = (name: string) => async () => {
    throw new Error(`the console was not to be asked: ${name}`);
  };
  return {
    skills: unexpected("skills"),
    skill: unexpected("skill"),
    skillFile: unexpected("skillFile"),
    skillBrowse: unexpected("skillBrowse"),
    skillFind: unexpected("skillFind"),
    skillRows: unexpected("skillRows"),
    skillCode: unexpected("skillCode"),
    ...reads,
  };
};

const packOf = (reads: Partial<PackClient>, dataCommand?: string) => {
  const pack = consolePack(reader(reads), LISTING, { url: "https://console.test", dataCommand });
  if (pack === undefined) {
    throw new Error("the listing answers a pack");
  }
  return pack;
};

describe("the pack made of the console's answers (ADR-0124)", () => {
  it("is made of a listing that answers a pack, and of no other", () => {
    expect(packOf({}).address).toMatchObject({ host: "gh", owner: "acme", repo: "skills" });
    expect(packOf({}).source).toEqual({ kind: "deployment", url: "https://skillcdn.test" });
    // A pack on the console's own machine is read at the console.
    expect(
      consolePack(reader({}), { ...LISTING, source: null, page: null }, { url: "https://c.test" })
        ?.source,
    ).toEqual({ kind: "deployment", url: "https://c.test" });
    for (const listing of [
      { ...LISTING, status: "not_found" as const, mount: null },
      { ...LISTING, status: "none" as const, address: null, mount: null },
      { ...LISTING, mount: null },
      { ...LISTING, address: "not an address" },
    ]) {
      expect(consolePack(reader({}), listing, { url: "https://console.test" })).toBeUndefined();
    }
  });

  it("lists the pack from the one answer the console has, the skills with the documents counted, and asks nothing for it", async () => {
    // No read is given to the console: the listing, and the skills a refusal names, come from the mount.
    const listed = await readPack(packOf({}), { read: "skills" }, { words: CONSOLE_WORDS });
    expect(listed.text).toContain("review/SKILL.md: Reviews a change.");
    expect(listed.text).toContain("SKILL.md: The root's own.");
    // The read lists the skills and counts the documents outside them (SkillCDN 0.6.3), from
    // the totals the pack gives with its listing.
    expect(listed.text).toContain("2 skills and 2 documents in acme/skills (commit 0123456):");
    expect(listed.text).toContain("1. skill: review (review/SKILL.md)");
    expect(listed.text).toContain(
      "The 2 documents outside the skills are not listed here: console skills <folder> lists a folder with what it holds, and console skills --search finds them by what they say.",
    );
    expect(listed.text).not.toContain("docs/guide.md");
    // The pack itself lists what a search without words lists: the skills first, then the
    // documents, a folder's README as its overview.
    const all = await packOf({}).find({});
    if (all.status !== "ready") {
      throw new Error("the listing is ready");
    }
    expect(all.totals).toEqual({ skills: 2, documents: 2 });
    expect(all.items.map((item) => [item.kind, item.path])).toEqual([
      ["skill", "review/SKILL.md"],
      ["skill", "SKILL.md"],
      ["document", "docs/README.md"],
      ["document", "docs/guide.md"],
    ]);
    expect(all.items[2]).toMatchObject({ overview: true });
    expect(all.items[3]).not.toHaveProperty("overview");
    const missing = packOf({
      skill: async () => refusedWith("not_found", "skill.not_found"),
    });
    await expect(
      readPack(missing, { read: "skill", path: "nothing/SKILL.md" }, { words: CONSOLE_WORDS }),
    ).rejects.toMatchObject({
      code: "skill.not_found",
      message:
        'No skill at "nothing/SKILL.md". Use console skills <folder> or console skills --search for its exact SKILL.md path. Available: review/SKILL.md, SKILL.md.',
    });
    // What the console answered last stays at hand, for --json and for the words of a refusal.
    expect(missing.answered()).toMatchObject({ status: "not_found" });
  });

  it("throws a refusal of one read as the pack's own, and one of the pack as a whole as the console's", async () => {
    const one = packOf({ skillFile: async () => refusedWith("not_found", "file.not_found") });
    const refused = await one.file({ path: "nothing.md" }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(PackError);
    expect(refused).toMatchObject({ code: "file.not_found", status: 404 });
    const large = packOf({ skillFile: async () => refusedWith("failed", "file.too_large") });
    await expect(large.file({ path: "big.bin" })).rejects.toMatchObject({
      code: "file.too_large",
      status: 415,
    });
    // Nothing is served to the console, a token that went stale, an index that is not there:
    // whatever its status, the pack as a whole, in the console's words.
    for (const [status, code] of [
      ["not_found", "mount.repo_not_found"],
      ["token_invalid", "auth.invalid_token"],
      ["failed", "index.failed"],
    ] as const) {
      const whole = packOf({ skill: async () => refusedWith(status, code) });
      const error = await whole.skill("review/SKILL.md").catch((thrown: unknown) => thrown);
      expect(error, code).toBeInstanceOf(PackRefusal);
      if (error instanceof PackRefusal) {
        expect(error.what).toBe("skill");
        expect(refusalWords(error.what, error.answer)).toContain(
          `skill at /gh/acme/skills, served by https://skillcdn.test: ${status}`,
        );
        expect(refusalWords(error.what, error.answer)).toContain(`Said by the pack: ${code}.`);
      }
    }
    // An answer that says ready and carries nothing is not a read.
    const empty = packOf({ skillRows: async () => ({ ...AT, read: null }) });
    const nothing = await empty.rows({}).catch((thrown: unknown) => thrown);
    expect(nothing).toBeInstanceOf(PackRefusal);
    if (nothing instanceof PackRefusal) {
      expect(refusalWords(nothing.what, nothing.answer)).toBe(
        "tables at /gh/acme/skills, served by https://skillcdn.test: ready\nNothing was read.",
      );
    }
  });

  it("names the reads of a document's tables and code blocks as commands where it is told the command, and leaves the console's addresses otherwise", async () => {
    const outline = async () => ({
      ...AT,
      read: {
        status: "ready" as const,
        commit: COMMIT,
        path: "docs/my codes.md",
        outline: {
          path: "docs/my codes.md",
          size: 10,
          totalLength: 10,
          headings: [],
          truncated: false,
          tables: { count: 1, rows: 2 },
          codeBlocks: 1,
          data: { rows: "/api/v1/projects/web/skills/rows?path=x", code: "/api/v1/x" },
        },
        entries: [],
        nextCursor: null,
      },
    });
    const named = await packOf({ skillBrowse: outline }, "console plugin hr skills").browse({});
    // In single quotes, which neither bash nor PowerShell reads into.
    expect(named.status === "ready" ? named.outline?.data : undefined).toEqual({
      rows: "console plugin hr skills --rows 'docs/my codes.md'",
      code: "console plugin hr skills --code 'docs/my codes.md'",
    });
    const kept = await packOf({ skillBrowse: outline }).browse({});
    expect(kept.status === "ready" ? kept.outline?.data : undefined).toEqual({
      rows: "/api/v1/projects/web/skills/rows?path=x",
      code: "/api/v1/x",
    });
    // A path a shell would expand in double quotes is printed so that it expands nothing; one
    // with a single quote is printed so that both shells take it as one word; and one that no
    // spelling keeps whole in both is printed as no line, with why.
    const outlineAt = (path: string) => async () => {
      const read = await outline();
      return { ...read, read: { ...read.read, path, outline: { ...read.read.outline, path } } };
    };
    const commandsFor = async (path: string) => {
      const read = await packOf({ skillBrowse: outlineAt(path) }, "console skills").browse({});
      return read.status === "ready" ? read.outline?.data : undefined;
    };
    expect(await commandsFor("docs/$(x) `y` $HOME.md")).toEqual({
      rows: "console skills --rows 'docs/$(x) `y` $HOME.md'",
      code: "console skills --code 'docs/$(x) `y` $HOME.md'",
    });
    expect(await commandsFor("docs/it's (draft).md")).toEqual({
      rows: `console skills --rows "docs/it's (draft).md"`,
      code: `console skills --code "docs/it's (draft).md"`,
    });
    const none = await commandsFor("docs/it's $(x).md");
    expect(none?.rows).toBe(
      `console skills --rows with this file's path, quoted for your shell. ${NO_LINE_TO_RUN}`,
    );
    expect(none?.code).toMatch(/^console skills --code with this file's path, quoted/);
    expect(JSON.stringify(none)).not.toContain("$(x)");
  });

  it("follows no more pages than one command reads, of a console that names the same cursor again", async () => {
    let asked = 0;
    const endless = packOf({
      skillRows: async () => {
        asked += 1;
        return {
          ...AT,
          read: {
            status: "ready" as const,
            commit: COMMIT,
            path: "docs",
            tables: [],
            rowCount: 0,
            nextCursor: "again",
          },
        };
      },
    });
    await expect(
      readPack(endless, { read: "rows", path: "docs" }, { words: CONSOLE_WORDS }),
    ).rejects.toMatchObject({
      code: "invalid_response",
      message:
        "The tables under docs are more than the command reads at once (64 pages): name a folder or a file under it.",
    });
    expect(asked).toBe(64);
  });

  it("names the reads by the commands a pack is read with", () => {
    expect(CONSOLE_WORDS).toEqual({
      browse: "console skills <folder>",
      search: "console skills --search",
      load: "console skill",
      read: "console skill --file",
    });
    expect(packWords("console plugin hr skills", "console plugin hr skill").read).toBe(
      "console plugin hr skill --file",
    );
  });
});

describe("the command's library of reads", () => {
  it("is imported by the command alone, so that no page's bundle carries it", () => {
    const src = fileURLToPath(new URL("..", import.meta.url));
    const importing: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(path);
        } else if (
          /\.tsx?$/.test(entry.name) &&
          /from\s+"@skillcdn\/cli"|import\("@skillcdn\/cli"\)/.test(readFileSync(path, "utf8"))
        ) {
          importing.push(relative(src, path).split(sep).join("/"));
        }
      }
    };
    walk(src);
    expect(importing.length).toBeGreaterThan(0);
    expect(importing.filter((path) => !path.startsWith("cli/"))).toEqual([]);
  });
});
