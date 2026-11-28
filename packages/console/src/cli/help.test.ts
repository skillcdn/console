import { describe, expect, it } from "vitest";
import {
  COMMAND_ALIASES,
  COMMAND_GROUPS,
  COMMAND_HELP,
  HELP_BOUNDS,
  helpFor,
  nearestCommands,
  usage,
} from "./help.js";

const bytes = (text: string): number => new TextEncoder().encode(text).length;

/** A path of ordinary length for the package's skills, as a machine-wide install on Windows has it. */
const SKILLS =
  "C:\\Users\\someone\\AppData\\Roaming\\npm\\node_modules\\@skillcdn\\console\\skills\\";

/** Every page there is: a command's, and each of its forms'. */
const pages = (): { readonly words: readonly string[]; readonly text: string }[] =>
  Object.entries(COMMAND_HELP).flatMap(([name, help]) =>
    [[name], ...Object.keys(help.forms ?? {}).map((form) => [name, form])].map((words) => {
      const found = helpFor(words, SKILLS);
      if (!("page" in found)) {
        throw new Error(`no page for ${words.join(" ")}`);
      }
      return { words, text: found.page };
    }),
  );

describe("the help of the command (ADR-0167)", () => {
  it("keeps the overview within its bound, with every command in one row of the table", () => {
    const overview = usage("0.6.3", SKILLS);
    expect(bytes(overview)).toBeLessThanOrEqual(HELP_BOUNDS.overview);
    // The table and the pages are of the same commands: each stands in one row, once.
    const listed = COMMAND_GROUPS.flatMap((group) => group.rows.flatMap((row) => row.commands));
    expect([...listed].sort()).toEqual(Object.keys(COMMAND_HELP).sort());
    expect(new Set(listed).size).toBe(listed.length);
    for (const name of listed) {
      expect(overview, name).toMatch(new RegExp(`^  (?:\\S+  )*${name}(?:  \\S+)*  `, "m"));
    }
    // It says where a command is said in full, where what holds everywhere is, and the skill.
    expect(overview).toContain("console help <command> [<form>]");
    expect(overview).toContain("console help everywhere");
    expect(overview).toContain(`${SKILLS}working-the-board\\SKILL.md`);
    // A word of before is in no list.
    for (const word of Object.keys(COMMAND_ALIASES)) {
      expect(listed).not.toContain(word);
      expect(COMMAND_HELP[word], word).toBeUndefined();
    }
  });

  it("keeps every page within its bound, a command's and a form's", () => {
    const over = pages()
      .map(({ words, text }) => ({ page: words.join(" "), size: bytes(text) }))
      .filter(({ size }) => size > HELP_BOUNDS.page);
    expect(over).toEqual([]);
    const everywhere = helpFor(["everywhere"]);
    expect("page" in everywhere && bytes(everywhere.page)).toBeLessThanOrEqual(HELP_BOUNDS.page);
  });

  it("prints a page's forms a line each, and names the forms that have a page of their own", () => {
    const task = helpFor(["task"]);
    if (!("page" in task)) {
      throw new Error("task has a page");
    }
    expect(task.page.startsWith("console task <number|id>\n\n")).toBe(true);
    expect(task.page).toContain("Its other forms, each in full with console help task <form>:");
    // Words that open one page stand on one line, with what the page is of.
    expect(task.page).toContain("\n  new: Writes a task down");
    expect(task.page).toContain("\n  archive, restore: Puts a task away");
    expect(task.page).toContain("\n  follow, mute: Turns a task's notifications on");
    const put = helpFor(["task", "restore"]);
    if (!("page" in put)) {
      throw new Error("task restore has a page");
    }
    expect(
      put.page.startsWith(
        "console task archive <number|id>\nconsole task archive --goal <id>\nconsole task restore <number|id>\n\n",
      ),
    ).toBe(true);
    expect(put.page).toContain("The command's other forms: console help task");
    // Every form's usage names its command, so that a line of it is one to type.
    for (const [name, help] of Object.entries(COMMAND_HELP)) {
      for (const [form, page] of Object.entries(help.forms ?? {})) {
        for (const line of page.usage.split("  |  ")) {
          expect(line.startsWith(`${name} `), `${name} ${form}: ${line}`).toBe(true);
        }
      }
      for (const line of help.usage.split("  |  ")) {
        expect(line === name || line.startsWith(`${name} `), `${name}: ${line}`).toBe(true);
      }
    }
  });

  it("reads a word of before as what took its place", () => {
    const old = helpFor(["write"]);
    const now = helpFor(["doc", "write"]);
    expect(old).toEqual(now);
    expect("page" in now && now.page.startsWith("console doc write <path>")).toBe(true);
    expect(helpFor(["mute"])).toEqual(helpFor(["task", "mute"]));
    for (const [word, [command, form]] of Object.entries(COMMAND_ALIASES)) {
      expect(COMMAND_HELP[command]?.forms?.[form], word).toBeDefined();
    }
  });

  it("answers a word that is no command, or no form, with what is near and what there is", () => {
    expect(helpFor(["taks"])).toEqual({ notCommand: "taks", near: ["take", "tasks", "task"] });
    expect(helpFor(["decisons"])).toMatchObject({ near: ["decisions", "decision"] });
    expect(helpFor(["zzzzzz"])).toEqual({ notCommand: "zzzzzz", near: [] });
    expect(nearestCommands("")).toEqual([]);
    expect(nearestCommands("hand")).toEqual(["hand-in"]);
    expect(helpFor(["task", "delete"])).toEqual({
      notForm: "delete",
      command: "task",
      forms: ["new", "edit", "archive", "restore", "follow", "mute"],
    });
    // A command with one page leaves a second word unread: its page is what was asked for.
    expect(helpFor(["take", "7"])).toEqual(helpFor(["take"]));
  });
});
