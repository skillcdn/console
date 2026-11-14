import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  builtPluginAt,
  keptSignInFailure,
  oneOriginRedirect,
  PREVIEW_DATABASE,
  parsePreviewArguments,
} from "./preview-plugins.js";

const made: string[] = [];
const scratch = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "console-preview-"));
  made.push(dir);
  return dir;
};
afterAll(async () => {
  for (const dir of made) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("what dev:plugins is told", () => {
  it("says what to do when the database it kept will not sign the fixture's people in", () => {
    const failure = keptSignInFailure(
      "bob",
      new Error("bob was not signed in: the console answered sign_in=refused"),
    );
    expect(failure.message).toContain(
      `bob could not sign in on the kept database ${PREVIEW_DATABASE} (bob was not signed in: the console answered sign_in=refused)`,
    );
    // Both reasons the console does not tell apart, and the way out of each.
    expect(failure.message).toContain("took bob out, which the People page undoes");
    expect(failure.message).toContain(`drop database ${PREVIEW_DATABASE} with (force)`);
    expect(failure.message).toContain("without --keep");
  });

  it("takes a port once and a plugin's directory as often as given, and refuses the rest", () => {
    const bare = {
      port: undefined,
      pluginDirs: [],
      publicUrl: undefined,
      keep: false,
      live: false,
    };
    expect(parsePreviewArguments([])).toEqual(bare);
    expect(
      parsePreviewArguments(["--plugin", "../plugins/hr", "--port", "11201", "--plugin", "x"]),
    ).toEqual({ ...bare, port: 11201, pluginDirs: ["../plugins/hr", "x"] });
    expect(() => parsePreviewArguments(["--port", "many"])).toThrow(/--port takes a port number/);
    expect(() => parsePreviewArguments(["--plugin"])).toThrow(/--plugin takes the directory/);
    expect(() => parsePreviewArguments(["--plugin", "--port"])).toThrow(/--plugin takes/);
    expect(() => parsePreviewArguments(["--verbose"])).toThrow(/is not understood/);
  });

  it("takes the address the console is reached at from outside, an origin and nothing more, and whether to keep the database", () => {
    expect(
      parsePreviewArguments(["--public-url", "https://preview.example.com/", "--keep"]),
    ).toMatchObject({ publicUrl: "https://preview.example.com", keep: true });
    expect(parsePreviewArguments(["--public-url", "http://10.0.0.5:8080"])).toMatchObject({
      publicUrl: "http://10.0.0.5:8080",
      keep: false,
    });
    for (const wrong of [
      "preview.example.com",
      "ftp://preview.example.com",
      "https://preview.example.com/console",
      "https://preview.example.com/?x=1",
      "https://user:pass@preview.example.com",
    ]) {
      expect(() => parsePreviewArguments(["--public-url", wrong])).toThrow(/--public-url takes/);
    }
    expect(() => parsePreviewArguments(["--public-url"])).toThrow(/--public-url takes/);
  });

  it("passes over the -- that pnpm hands on with the flags that followed it", () => {
    expect(parsePreviewArguments(["--", "--plugin", "../plugins/hr"])).toMatchObject({
      port: undefined,
      pluginDirs: ["../plugins/hr"],
    });
    expect(parsePreviewArguments(["--port", "11201", "--", "--plugin", "x"])).toMatchObject({
      port: 11201,
      pluginDirs: ["x"],
    });
    expect(() => parsePreviewArguments(["--plugin", "--"])).toThrow(/--plugin takes/);
  });

  it("serves the pages from their sources when told, on this machine and at a port", () => {
    expect(parsePreviewArguments(["--live"])).toMatchObject({ live: true, port: undefined });
    expect(parsePreviewArguments(["--live", "--port", "11270", "--keep"])).toMatchObject({
      live: true,
      port: 11270,
      keep: true,
    });
    // A development server is for this machine alone, and a browser is told where it is.
    expect(() =>
      parsePreviewArguments(["--live", "--public-url", "https://preview.example.com"]),
    ).toThrow(/--live serves the pages from their sources on this machine alone/);
    expect(() => parsePreviewArguments(["--port", "0", "--live"])).toThrow(/--live takes the port/);
    expect(parsePreviewArguments(["--port", "0"])).toMatchObject({ port: 0, live: false });
  });

  it("sends a browser that came by another of the machine's names to the one origin", () => {
    const own = "http://127.0.0.1:11200";
    // The name a tool opens a local server by, and the loopback of the other family.
    expect(oneOriginRedirect("localhost:11200", own, "/")).toBe(`${own}/`);
    expect(oneOriginRedirect("localhost:11200", own, "/projects/ledger?mine=1")).toBe(
      `${own}/projects/ledger?mine=1`,
    );
    expect(oneOriginRedirect("[::1]:11200", own, "/__fixture/sign-in/alice")).toBe(
      `${own}/__fixture/sign-in/alice`,
    );
    expect(oneOriginRedirect("LOCALHOST:11200", own, "/")).toBe(`${own}/`);
    // The port a console listens on behind the pages is not where it is opened.
    expect(oneOriginRedirect("127.0.0.1:54021", own, "/work")).toBe(`${own}/work`);
    expect(oneOriginRedirect("localhost", own, "/")).toBe(`${own}/`);
    // By its own origin, a request is answered where it came.
    expect(oneOriginRedirect("127.0.0.1:11200", own, "/")).toBeUndefined();
    expect(oneOriginRedirect("localhost:11200", "http://localhost:11200", "/")).toBeUndefined();
  });

  it("leaves a request alone that names no name of this machine, or a console reached from outside", () => {
    const own = "http://127.0.0.1:11200";
    // A name of somewhere else is not this console's to correct: it is served as it came.
    expect(oneOriginRedirect("console.example.com", own, "/")).toBeUndefined();
    expect(oneOriginRedirect("localhost.example.com:11200", own, "/")).toBeUndefined();
    expect(oneOriginRedirect("10.0.0.5:11200", own, "/")).toBeUndefined();
    expect(oneOriginRedirect(undefined, own, "/")).toBeUndefined();
    expect(oneOriginRedirect("", own, "/")).toBeUndefined();
    expect(oneOriginRedirect("not a host", own, "/")).toBeUndefined();
    expect(oneOriginRedirect("localhost:99999999", own, "/")).toBeUndefined();
    // A name of this machine written before another host's is that host's.
    expect(oneOriginRedirect("localhost:11200@elsewhere.example", own, "/")).toBeUndefined();
    // Behind a tunnel, whoever comes on the machine itself is served where they came.
    expect(
      oneOriginRedirect("127.0.0.1:11200", "https://preview.example.com", "/"),
    ).toBeUndefined();
    expect(
      oneOriginRedirect("localhost:11200", "https://preview.example.com", "/"),
    ).toBeUndefined();
  });

  it("answers with an address of the console whatever the path says", () => {
    const own = "http://127.0.0.1:11200";
    // A path that would read as another host after a bare slash stays a path of this origin.
    for (const path of ["//elsewhere.example/x", "/\\elsewhere.example", "elsewhere.example", ""]) {
      const there = oneOriginRedirect("localhost:11200", own, path);
      expect(there).toBeDefined();
      expect(new URL(there ?? "").origin).toBe(own);
    }
  });

  it("installs a built plugin by its package's name, and says why one cannot be", async () => {
    const dir = await scratch();
    await expect(builtPluginAt("nothing", dir)).rejects.toThrow(/is not a directory/);
    const plugin = join(dir, "hr");
    await mkdir(plugin);
    await expect(builtPluginAt("hr", dir)).rejects.toThrow(/has no package.json/);
    await writeFile(join(plugin, "package.json"), "{");
    await expect(builtPluginAt("hr", dir)).rejects.toThrow(/is not JSON/);
    await writeFile(join(plugin, "package.json"), JSON.stringify({ version: "1.0.0" }));
    await expect(builtPluginAt("hr", dir)).rejects.toThrow(/names no package/);
    await writeFile(
      join(plugin, "package.json"),
      JSON.stringify({ name: "@acme/console-plugin-hr", version: "1.0.0" }),
    );
    await expect(builtPluginAt("hr", dir)).rejects.toThrow(/has no console-plugin.json/);
    await writeFile(join(plugin, "console-plugin.json"), "{}");
    await expect(builtPluginAt("hr", dir)).rejects.toThrow(/has no dist\/: build the plugin first/);
    await mkdir(join(plugin, "dist"));
    expect(await builtPluginAt("hr", dir)).toEqual({
      name: "@acme/console-plugin-hr",
      dir: plugin,
    });
  });
});
