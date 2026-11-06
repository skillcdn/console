import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { PluginDescription } from "../plugin/define.js";
import type { ServerLoad } from "../plugin/load.js";
import {
  classesIn,
  coveredByFiles,
  isPermissiveLicense,
  sameAsEnglish,
  webBundleProblems,
} from "./plugin-check.js";
import { type PluginCliIo, runPluginCli } from "./plugin-cli.js";
import { nameFromKey } from "./plugin-init.js";

const TEMPLATE = fileURLToPath(new URL("../../template/plugin/", import.meta.url));
const EXAMPLE = fileURLToPath(new URL("../../../../examples/plugin-hello/", import.meta.url));
const SKIPPED = new Set(["node_modules", "dist", ".turbo"]);

/** What the server module of the template describes itself as, as the hardened thread would answer. */
const HELLO_DESCRIPTION: PluginDescription = {
  pluginApi: 1,
  collections: [
    {
      name: "greetings",
      indexes: ["to", "by"],
      search: ["text"],
      owner: "by",
      project: "none",
      read: ["greeter"],
      readOwn: [],
      history: true,
    },
  ],
  commands: {
    greet: {
      about: "Greets someone, and keeps the greeting as a record.",
      args: {
        to: { type: "text", about: "who is greeted", optional: false, positional: true, max: 80 },
        text: { type: "text", about: "the words", optional: true, positional: false, max: 200 },
      },
      roles: ["greeter"],
    },
  },
  queries: {
    latest: {
      about: "The latest greetings, newest first.",
      args: {
        limit: {
          type: "number",
          optional: true,
          positional: false,
          integer: true,
          min: 1,
          max: 50,
        },
      },
      roles: ["greeter"],
    },
  },
  endpoints: {},
  hooks: [],
  jobs: {},
  upgrades: [],
  api: {},
  onEnable: false,
  onDisable: false,
};

async function filesUnder(root: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (SKIPPED.has(entry.name)) {
        continue;
      }
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else {
        files.push(relative(root, path).split(sep).join("/"));
      }
    }
  };
  await walk(root);
  return files.sort();
}

function ioOf(
  cwd: string,
  loadServer: (file: string) => Promise<ServerLoad> = async () => ({
    ok: true,
    description: HELLO_DESCRIPTION,
  }),
) {
  const out: string[] = [];
  const err: string[] = [];
  const io: PluginCliIo = {
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    cwd,
    templateDir: TEMPLATE,
    version: "0.4.1",
    loadServer,
  };
  return { io, out: () => out.join(""), err: () => err.join("") };
}

const made: string[] = [];
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "console-plugin-"));
  made.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of made.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("console-plugin init", () => {
  it("writes examples/plugin-hello, which is kept equal to what init writes for the key hello", async () => {
    const dir = await scratch();
    const { io, out } = ioOf(dir);
    expect(
      await runPluginCli(["init", "hello", "--key", "hello", "--console", "workspace:*"], io),
    ).toBe(0);
    expect(out()).toMatch(/Wrote the plugin hello/);
    const written = join(dir, "hello");
    expect(await filesUnder(written)).toEqual(await filesUnder(EXAMPLE));
    for (const file of await filesUnder(written)) {
      const fresh = (await readFile(join(written, file), "utf8")).replaceAll("\r\n", "\n");
      const kept = (await readFile(join(EXAMPLE, file), "utf8")).replaceAll("\r\n", "\n");
      if (file === "package.json") {
        // The example is private, since the repository publishes one package; nothing else differs.
        const { private: isPrivate, ...rest } = JSON.parse(kept) as { private?: boolean };
        expect(isPrivate).toBe(true);
        expect(JSON.parse(fresh)).toEqual(rest);
      } else {
        expect(fresh, file).toBe(kept);
      }
    }
  });

  it("substitutes the key, the name and the dependency everywhere, leaving no template word", async () => {
    const dir = await scratch();
    const { io } = ioOf(dir);
    expect(
      await runPluginCli(["init", "out", "--key", "leave-days", "--name", "Leave days"], io),
    ).toBe(0);
    const files = await filesUnder(join(dir, "out"));
    expect(files).toContain("skills/leave-days/SKILL.md");
    for (const file of files) {
      const text = await readFile(join(dir, "out", file), "utf8");
      expect(text, file).not.toMatch(/__(package|key|name|console|consoleRange)__/);
    }
    const manifest = JSON.parse(
      await readFile(join(dir, "out", "console-plugin.json"), "utf8"),
    ) as { key: string; name: { en: string } };
    expect(manifest).toMatchObject({ key: "leave-days", name: { en: "Leave days" } });
    const pkg = JSON.parse(await readFile(join(dir, "out", "package.json"), "utf8")) as {
      name: string;
      devDependencies: Record<string, string>;
    };
    expect(pkg.name).toBe("console-plugin-leave-days");
    expect(pkg.devDependencies["@skillcdn/console"]).toBe("^0.4.1");
    expect(await readFile(join(dir, "out", "src/web/index.css"), "utf8")).toContain(
      ".pl-leave-days-page",
    );
  });

  it("writes the consoles the plugin runs on: the line of the dependency's version, or none where it names none", async () => {
    const dir = await scratch();
    const { io } = ioOf(dir);
    const consoleOf = async (out: string) =>
      (
        JSON.parse(await readFile(join(dir, out, "console-plugin.json"), "utf8")) as {
          console?: string;
        }
      ).console;
    expect(await runPluginCli(["init", "a", "--key", "aa", "--console", "^0.4.3"], io)).toBe(0);
    expect(await consoleOf("a")).toBe(">=0.4.3 <0.5.0");
    // No --console: the dependency is the command's own version, and so is the line.
    expect(await runPluginCli(["init", "b", "--key", "bb"], io)).toBe(0);
    expect(await consoleOf("b")).toBe(">=0.4.1 <0.5.0");
    // A dependency that names no version, as a workspace's, names no console either.
    expect(await runPluginCli(["init", "c", "--key", "cc", "--console", "workspace:*"], io)).toBe(
      0,
    );
    expect(await consoleOf("c")).toBeUndefined();
    const manifest = JSON.parse(
      await readFile(join(dir, "c", "console-plugin.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(Object.keys(manifest)).not.toContain("console");
  });

  it("names the package, the repository and the languages, so that less is adapted by hand", async () => {
    const dir = await scratch();
    const { io, err } = ioOf(dir);
    expect(
      await runPluginCli(
        [
          "init",
          "hr",
          "--key",
          "hr",
          "--name",
          "HR",
          "--package",
          "@acme/console-plugin-hr",
          "--repository",
          "https://github.com/acme/console-plugins",
          "--directory",
          "plugins/hr",
          "--languages",
          "en,ko",
        ],
        io,
      ),
    ).toBe(0);
    const read = async (file: string) =>
      (await readFile(join(dir, "hr", file), "utf8")).replaceAll("\r\n", "\n");
    const pkg = JSON.parse(await read("package.json")) as Record<string, unknown>;
    expect(pkg.name).toBe("@acme/console-plugin-hr");
    expect(pkg.publishConfig).toEqual({ access: "public" });
    expect(pkg.repository).toEqual({
      type: "git",
      url: "https://github.com/acme/console-plugins",
      directory: "plugins/hr",
    });
    expect(pkg.homepage).toBe("https://github.com/acme/console-plugins/tree/HEAD/plugins/hr");
    expect(pkg.bugs).toEqual({ url: "https://github.com/acme/console-plugins/issues" });
    const manifest = JSON.parse(await read("console-plugin.json")) as {
      name: Record<string, string>;
      store: unknown;
      roles: Record<string, { name: Record<string, string> }>;
      settings: { description: Record<string, string> }[];
      pages: { name: Record<string, string> }[];
      widgets: { name: Record<string, string> }[];
      board: unknown;
    };
    expect(manifest.store).toEqual({
      homepage: "https://github.com/acme/console-plugins/tree/HEAD/plugins/hr",
      repository: "https://github.com/acme/console-plugins",
    });
    // Every language map has Korean, the English words again, for the author to translate.
    expect(manifest.name).toEqual({ en: "HR", ko: "HR" });
    expect(manifest.roles.greeter?.name.ko).toBe("Greeter");
    expect(manifest.settings[0]?.description.ko).toBe(manifest.settings[0]?.description.en);
    expect(manifest.pages[0]?.name.ko).toBe("Greetings");
    expect(manifest.widgets[0]?.name.ko).toBe("Latest greeting");
    expect(manifest.board).toEqual({ needs: "none" });
    expect(sameAsEnglish(manifest)).toEqual(
      expect.arrayContaining(["name.ko", "roles.greeter.name.ko", "pages[0].name.ko"]),
    );
    // Both manifests in the SkillCDN Format carry the translations too.
    expect(await read("SKILLCDN.md")).toMatch(
      /^translations:\n {2}ko:\n {4}name: "HR"\n {4}description: "The skills of HR, a plugin of the SkillCDN Console: how an agent greets through it and reads the greetings."\n---$/m,
    );
    expect(await read("skills/hr/SKILL.md")).toMatch(
      /^skillcdn:\n {2}translations:\n {4}ko:\n {6}title: "HR"\n {6}description: "Greets someone through the HR plugin/m,
    );
    // What is not a package name, a directory without its repository, an address that is not
    // https, and languages that do not begin with English are refused.
    expect(await runPluginCli(["init", "x", "--key", "hr", "--package", "Acme/HR"], io)).toBe(2);
    expect(err()).toMatch(/is not a package name/);
    expect(await runPluginCli(["init", "x", "--key", "hr", "--directory", "plugins/hr"], io)).toBe(
      2,
    );
    expect(err()).toMatch(/--directory goes with --repository/);
    expect(
      await runPluginCli(
        ["init", "x", "--key", "hr", "--repository", "git@github.com:acme/plugins.git"],
        io,
      ),
    ).toBe(2);
    expect(err()).toMatch(/is not the https address/);
    expect(await runPluginCli(["init", "x", "--key", "hr", "--languages", "ko,en"], io)).toBe(2);
    expect(err()).toMatch(/begins with en/);
    expect(await runPluginCli(["init", "x", "--key", "hr", "--languages", "en,Korean"], io)).toBe(
      2,
    );
    expect(err()).toMatch(/list of language tags/);
  });

  it("refuses a bad key, a reserved key, and a directory that is not empty", async () => {
    const dir = await scratch();
    const { io, err } = ioOf(dir);
    expect(await runPluginCli(["init", "x", "--key", "Leave"], io)).toBe(2);
    expect(err()).toMatch(/is not a key/);
    expect(await runPluginCli(["init", "x", "--key", "settings"], io)).toBe(2);
    expect(err()).toMatch(/reserves/);
    expect(await runPluginCli(["init", "x"], io)).toBe(2);
    await mkdir(join(dir, "full"));
    await writeFile(join(dir, "full", "a.txt"), "a");
    expect(await runPluginCli(["init", "full", "--key", "hello"], io)).toBe(1);
    expect(err()).toMatch(/is not empty/);
  });

  it("names a plugin from its key", () => {
    expect(nameFromKey("leave")).toBe("Leave");
    expect(nameFromKey("leave-days")).toBe("Leave Days");
  });
});

describe("console-plugin check", () => {
  async function pluginDir(): Promise<string> {
    const dir = await scratch();
    const { io } = ioOf(dir);
    await runPluginCli(["init", "p", "--key", "hello"], io);
    return join(dir, "p");
  }

  async function built(root: string, css = ".pl-hello-page { color: red; }"): Promise<void> {
    await mkdir(join(root, "dist", "server"), { recursive: true });
    await mkdir(join(root, "dist", "web"), { recursive: true });
    await writeFile(join(root, "dist", "server", "index.js"), "export default {};\n");
    await writeFile(
      join(root, "dist", "web", "index.js"),
      "const root = document.getElementById('root');\n",
    );
    await writeFile(join(root, "dist", "web", "index.css"), css);
  }

  it("says what is missing before a build", async () => {
    const root = await pluginDir();
    const { io, out } = ioOf(root);
    expect(await runPluginCli(["check"], io)).toBe(1);
    expect(out()).toMatch(/error: server names dist\/server\/index.js, which is missing/);
    expect(out()).toMatch(/error: web names dist\/web, which is not a directory/);
    expect(out()).toMatch(/2 problems in hello 0.1.0/);
  });

  it("passes a built plugin whose server module describes what the manifest declares", async () => {
    const root = await pluginDir();
    await built(root);
    const { io, out } = ioOf(root);
    expect(await runPluginCli(["check", root], io)).toBe(0);
    expect(out()).toMatch(
      /^ok: hello 0.1.0: 1 collections, 1 commands, 1 queries, 0 endpoints, 0 hooks, 0 jobs, 1 pages, 1 widgets, 1 settings, 1 roles, 1 skills$/m,
    );
  });

  it("names a server module that does not load, and one that names what the manifest lacks", async () => {
    const root = await pluginDir();
    await built(root);
    const failing = ioOf(root, async () => ({
      ok: false,
      error: "the definition is invalid",
      problems: ["help is a subcommand"],
    }));
    expect(await runPluginCli(["check", root], failing.io)).toBe(1);
    expect(failing.out()).toMatch(
      /does not load under the host's hardening: the definition is invalid/,
    );
    expect(failing.out()).toMatch(/error: dist\/server\/index.js: help is a subcommand/);

    const stranger = ioOf(root, async () => ({
      ok: true,
      description: {
        ...HELLO_DESCRIPTION,
        commands: {
          ...HELLO_DESCRIPTION.commands,
          fire: { about: "Fires.", args: {}, roles: ["boss"] },
        },
        jobs: { nightly: { about: "x", every: "P1D", at: null } },
      },
    }));
    expect(await runPluginCli(["check", root], stranger.io)).toBe(1);
    expect(stranger.out()).toMatch(
      /the command fire names the role boss, which the manifest does not declare/,
    );
    expect(stranger.out()).toMatch(/the job nightly needs the capability jobs/);
  });

  it("refuses a server bundle that reaches for the network, and a web bundle that is not self-contained", async () => {
    const root = await pluginDir();
    await built(root, ".pl-hello-page {} .card {} .sc-button {}");
    await writeFile(
      join(root, "dist", "server", "index.js"),
      'import http from "node:http"; fetch("https://x");\n',
    );
    await writeFile(
      join(root, "dist", "web", "index.js"),
      'import React from "react"; fetch("/api/v1/me"); document.cookie;\n',
    );
    const { io, out } = ioOf(root);
    expect(await runPluginCli(["check", root], io)).toBe(1);
    expect(out()).toMatch(/dist\/server\/index.js imports node:http, which the host refuses/);
    expect(out()).toMatch(/dist\/server\/index.js calls fetch, which the host removes/);
    expect(out()).toMatch(/dist\/web\/index.js imports react from elsewhere/);
    expect(out()).toMatch(/dist\/web\/index.js uses fetch/);
    expect(out()).toMatch(/dist\/web\/index.js uses document.cookie/);
    expect(out()).toMatch(
      /warning: dist\/web\/index.css styles card: a plugin's classes begin with pl-hello-/,
    );
  });

  it("holds package.json to what a store asks", async () => {
    const root = await pluginDir();
    await built(root);
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
    pkg.license = "GPL-3.0";
    pkg.type = "commonjs";
    pkg.files = ["dist"];
    pkg.scripts = { ...(pkg.scripts as Record<string, string>), postinstall: "node evil.js" };
    await writeFile(join(root, "package.json"), JSON.stringify(pkg));
    const { io, out } = ioOf(root);
    expect(await runPluginCli(["check", root], io)).toBe(1);
    expect(out()).toMatch(/license GPL-3.0 is not a permissive license/);
    expect(out()).toMatch(/type is not "module"/);
    expect(out()).toMatch(/has a postinstall script/);
    expect(out()).toMatch(/files leaves out console-plugin.json/);
    expect(out()).toMatch(/files leaves out skills/);
  });

  it("holds the dependency on the console to the consoles the manifest declares", async () => {
    const root = await pluginDir();
    await built(root);
    const manifestPath = join(root, "console-plugin.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    expect(manifest.console).toBe(">=0.4.1 <0.5.0");
    const pkgPath = join(root, "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as {
      devDependencies: Record<string, string>;
    };
    expect(pkg.devDependencies["@skillcdn/console"]).toBe("^0.4.1");
    // A range that leaves the command's own console out is a warning: the plugin may be for a later one.
    manifest.console = ">=0.5.0 <0.6";
    await writeFile(manifestPath, JSON.stringify(manifest));
    const later = ioOf(root);
    expect(await runPluginCli(["check", root], later.io)).toBe(1);
    expect(later.out()).toMatch(
      /error: package.json: devDependencies names @skillcdn\/console \^0.4.1, outside the consoles the manifest declares \(console >=0.5.0 <0.6\)/,
    );
    expect(later.out()).toMatch(
      /warning: console-plugin.json: console >=0.5.0 <0.6 leaves out 0.4.1, the console this command belongs to/,
    );
    // The dependency within the range: nothing to say of it.
    pkg.devDependencies["@skillcdn/console"] = "^0.5.1";
    await writeFile(pkgPath, JSON.stringify(pkg));
    const fits = ioOf(root);
    expect(await runPluginCli(["check", root], fits.io)).toBe(0);
    expect(fits.out()).not.toMatch(/outside the consoles/);
  });

  it("refuses a manifest the console cannot read, with every problem", async () => {
    const root = await pluginDir();
    await writeFile(
      join(root, "console-plugin.json"),
      JSON.stringify({ key: "settings", name: { ko: "x" }, pluginApi: 1, server: "a.js" }),
    );
    const { io, out } = ioOf(root);
    expect(await runPluginCli(["check", root], io)).toBe(1);
    expect(out()).toMatch(/error: console-plugin.json: key: is a word the console reserves/);
    expect(out()).toMatch(/error: console-plugin.json: name: needs an English text under en/);
    expect(out()).toMatch(/error: console-plugin.json: description: /);
    await writeFile(join(root, "console-plugin.json"), "{");
    expect(await runPluginCli(["check", root], ioOf(root).io)).toBe(1);
    await rm(join(root, "console-plugin.json"));
    const missing = ioOf(root);
    expect(await runPluginCli(["check", root], missing.io)).toBe(1);
    expect(missing.out()).toMatch(/console-plugin.json is missing/);
  });

  it("holds the skills to the format", async () => {
    const root = await pluginDir();
    await built(root);
    await writeFile(
      join(root, "skills", "hello", "SKILL.md"),
      "---\nname: other\ndescription: x\n---\nNo heading\n",
    );
    await rm(join(root, "SKILLCDN.md"));
    const { io, out } = ioOf(root);
    expect(await runPluginCli(["check", root], io)).toBe(1);
    expect(out()).toMatch(/SKILLCDN.md is missing at the package root/);
    expect(out()).toMatch(/skills\/hello\/SKILL.md is named other, not hello/);
    expect(out()).toMatch(/does not start its body with a level-one heading/);
  });
});

describe("console-plugin", () => {
  it("prints its help and its version, and refuses a command it does not know", async () => {
    const { io, out, err } = ioOf(".");
    expect(await runPluginCli([], io)).toBe(0);
    expect(out()).toMatch(/console-plugin init <dir> --key <key>/);
    expect(await runPluginCli(["--version"], io)).toBe(0);
    expect(out()).toMatch(/0\.4\.1/);
    expect(await runPluginCli(["publish"], io)).toBe(2);
    expect(err()).toMatch(/publish is not a command/);
  });
});

describe("the checks", () => {
  it("tell a permissive license", () => {
    expect(isPermissiveLicense("MIT")).toBe(true);
    expect(isPermissiveLicense("(MIT OR GPL-3.0)")).toBe(true);
    expect(isPermissiveLicense("MIT AND GPL-3.0")).toBe(false);
    expect(isPermissiveLicense("FSL-1.1-ALv2")).toBe(false);
  });

  it("tell what npm's files list ships", () => {
    expect(coveredByFiles(["dist", "skills"], "dist/server/index.js")).toBe(true);
    expect(coveredByFiles(["dist/"], "dist/web")).toBe(true);
    expect(coveredByFiles(["dist/**/*.js"], "dist/web/index.js")).toBe(true);
    expect(coveredByFiles(["dist"], "console-plugin.json")).toBe(false);
    expect(coveredByFiles(["*.json"], "console-plugin.json")).toBe(true);
    expect(coveredByFiles(["!dist"], "dist/x.js")).toBe(false);
  });

  it("read the classes a stylesheet styles", () => {
    expect(
      classesIn('.pl-a-x { } .b:hover, div.c { width: 0.5em } /* .d */ a[href=".e"] .f { }').sort(),
    ).toEqual(["b", "c", "f", "pl-a-x"]);
  });

  it("find what a web bundle must not do", () => {
    expect(
      webBundleProblems('import { connect } from "./bridge.js"; export * from "./x.js";'),
    ).toEqual([]);
    expect(
      webBundleProblems('import x from "https://cdn.example/x.js"; new XMLHttpRequest();'),
    ).toEqual([
      "imports https://cdn.example/x.js from elsewhere: a bundle is self-contained",
      "uses XMLHttpRequest: a frame speaks to the console through the bridge alone",
    ]);
  });
});
