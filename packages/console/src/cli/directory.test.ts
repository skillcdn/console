import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDirectoryStore, DIRECTORY_FILE, parseDirectorySettings } from "./directory.js";

describe("what a directory says of its project", () => {
  const made: string[] = [];
  const directory = async () => {
    const path = await mkdtemp(join(tmpdir(), "console-directory-"));
    made.push(path);
    return path;
  };
  afterEach(async () => {
    for (const path of made.splice(0)) {
      await rm(path, { recursive: true, force: true });
    }
  });

  it("keeps the project, the console and the account, and drops everything else", () => {
    expect(parseDirectorySettings({ project: "web" })).toEqual({ project: "web" });
    expect(
      parseDirectorySettings({
        project: "web",
        url: "https://b.test",
        account: "bob",
        token: "cns_t_x",
        code: 1,
      }),
    ).toEqual({ project: "web", url: "https://b.test", account: "bob" });
    for (const hostile of [
      null,
      "web",
      [],
      {},
      { project: "" },
      { project: 7 },
      { project: "web", url: "" },
    ]) {
      expect(parseDirectorySettings(hostile)).toBeUndefined();
    }
  });

  it("is found in the directory or one above it, and written with the three settings alone", async () => {
    const root = await directory();
    const nested = join(root, "a", "b");
    await mkdir(nested, { recursive: true });
    await writeFile(
      join(root, DIRECTORY_FILE),
      JSON.stringify({ project: "web", url: "https://b.test", token: "cns_t_leaked" }),
    );
    const store = createDirectoryStore(nested);
    expect(await store.load()).toEqual({ project: "web", url: "https://b.test" });
    const path = await store.save({ project: "ops", url: "https://b.test", account: "bob" });
    expect(path).toBe(join(nested, DIRECTORY_FILE));
    const written = await readFile(path, "utf8");
    expect(JSON.parse(written)).toEqual({ project: "ops", url: "https://b.test", account: "bob" });
    expect(written).not.toContain("token");
    // A file that is not the settings, or is far too large, is as good as none.
    await writeFile(path, "not json");
    expect(await store.load()).toBeUndefined();
    await writeFile(path, JSON.stringify({ project: "x".repeat(20_000) }));
    expect(await store.load()).toBeUndefined();
  });
});
