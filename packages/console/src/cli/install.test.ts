import { describe, expect, it } from "vitest";
import { describeInstall, detectInstall, updateCommandFor } from "./install.js";

const none = () => false;

describe("where the command is installed", () => {
  it("tells a global install, and the manager that made it, from the package's path", () => {
    const npm = detectInstall({
      packageDir: "C:\\Users\\alice\\AppData\\Roaming\\npm\\node_modules\\@skillcdn\\console\\",
      cwd: "C:\\Projects\\app",
      env: {},
      exists: none,
    });
    expect(npm).toEqual({
      kind: "global",
      manager: "npm",
      root: "C:/Users/alice/AppData/Roaming/npm",
    });
    expect(updateCommandFor(npm, "0.1.18")).toBe("npm install -g @skillcdn/console@0.1.18");
    expect(describeInstall(npm)).toBe(
      "installed for the machine with npm in C:/Users/alice/AppData/Roaming/npm",
    );
    const pnpm = detectInstall({
      packageDir:
        "/home/alice/.local/share/pnpm/global/5/node_modules/.pnpm/@skillcdn+console@0.1.17/node_modules/@skillcdn/console",
      cwd: "/work/app",
      env: {},
      exists: none,
    });
    expect(pnpm.kind).toBe("global");
    expect(updateCommandFor(pnpm, "0.1.18")).toBe("pnpm add -g @skillcdn/console@0.1.18");
    expect(
      updateCommandFor(
        detectInstall({
          packageDir: "/home/alice/.config/yarn/global/node_modules/@skillcdn/console",
          cwd: "/work/app",
          env: {},
          exists: none,
        }),
        "0.1.18",
      ),
    ).toBe("yarn global add @skillcdn/console@0.1.18");
    expect(
      updateCommandFor(
        detectInstall({
          packageDir: "/home/alice/.bun/install/global/node_modules/@skillcdn/console",
          cwd: "/work/app",
          env: {},
          exists: none,
        }),
        "0.1.18",
      ),
    ).toBe("bun add -g @skillcdn/console@0.1.18");
  });

  it("tells a project install when the working directory is in the project, with the manager its lockfile names", () => {
    const files = new Set(["/work/app/pnpm-lock.yaml"]);
    const inProject = detectInstall({
      packageDir:
        "/work/app/node_modules/.pnpm/@skillcdn+console@0.1.17/node_modules/@skillcdn/console",
      cwd: "/work/app/src/pages",
      env: {},
      exists: (path) => files.has(path),
    });
    expect(inProject).toEqual({ kind: "project", manager: "pnpm", root: "/work/app" });
    expect(updateCommandFor(inProject, "0.1.18")).toBe("pnpm add @skillcdn/console@0.1.18");
    expect(describeInstall(inProject)).toBe("installed in the project at /work/app with pnpm");
    const withNpm = detectInstall({
      packageDir: "/work/app/node_modules/@skillcdn/console",
      cwd: "/work/app",
      env: {},
      exists: none,
    });
    expect(withNpm.manager).toBe("npm");
    expect(updateCommandFor(withNpm, "0.1.18")).toBe("npm install @skillcdn/console@0.1.18");
    const yarn = detectInstall({
      packageDir: "/work/app/node_modules/@skillcdn/console",
      cwd: "/work/app",
      env: {},
      exists: (path) => path === "/work/app/yarn.lock",
    });
    expect(updateCommandFor(yarn, "0.1.18")).toBe("yarn add @skillcdn/console@0.1.18");
    const bun = detectInstall({
      packageDir: "/work/app/node_modules/@skillcdn/console",
      cwd: "/work/app",
      env: {},
      exists: (path) => path === "/work/app/bun.lockb",
    });
    expect(updateCommandFor(bun, "0.1.18")).toBe("bun add @skillcdn/console@0.1.18");
    // Run through a manager with no lockfile to say: the manager that ran it.
    const exec = detectInstall({
      packageDir: "/work/app/node_modules/@skillcdn/console",
      cwd: "/work/app",
      env: { npm_config_user_agent: "pnpm/12.4.2 npm/? node/v24.11.0 win32 x64" },
      exists: none,
    });
    expect(exec.manager).toBe("pnpm");
    // The same package, from a directory outside the project, is the machine's as far as the command can tell.
    const elsewhere = detectInstall({
      packageDir: "/work/app/node_modules/@skillcdn/console",
      cwd: "/work/other",
      env: {},
      exists: none,
    });
    expect(elsewhere.kind).toBe("global");
  });

  it("tells a run from a cache, and says to run it again at the version", () => {
    const npx = detectInstall({
      packageDir: "/home/alice/.npm/_npx/0123abcd/node_modules/@skillcdn/console",
      cwd: "/work/app",
      env: { npm_config_user_agent: "npm/10.9.0 node/v24.11.0 linux x64" },
      exists: none,
    });
    expect(npx.kind).toBe("temporary");
    expect(updateCommandFor(npx, "0.1.18")).toBe("npx @skillcdn/console@0.1.18");
    expect(describeInstall(npx)).toBe("fetched for this run by npm");
    const dlx = detectInstall({
      packageDir:
        "/home/alice/.cache/pnpm/dlx/abcdef/node_modules/.pnpm/@skillcdn+console@0.1.17/node_modules/@skillcdn/console",
      cwd: "/work/app",
      env: {},
      exists: none,
    });
    expect(updateCommandFor(dlx, "0.1.18")).toBe("pnpm dlx @skillcdn/console@0.1.18");
    const bunx = detectInstall({
      packageDir: "/home/alice/.bun/install/cache/x/node_modules/@skillcdn/console",
      cwd: "/work/app",
      env: {},
      exists: none,
    });
    expect(updateCommandFor(bunx, "0.1.18")).toBe("bunx @skillcdn/console@0.1.18");
  });

  it("tells a checkout, where there is no node_modules above the package", () => {
    const checkout = detectInstall({
      packageDir: "C:\\Projects\\console\\packages\\console\\",
      cwd: "C:\\Projects\\console",
      env: {},
      exists: none,
    });
    expect(checkout).toEqual({
      kind: "checkout",
      manager: "pnpm",
      root: "C:/Projects/console/packages/console",
    });
    expect(updateCommandFor(checkout, "0.1.18")).toBe("git pull && pnpm install && pnpm build");
    expect(describeInstall(checkout)).toBe(
      "built from the checkout at C:/Projects/console/packages/console",
    );
  });
});
