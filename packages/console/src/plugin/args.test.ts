import { describe, expect, it } from "vitest";
import {
  type ArgDefinition,
  type ArgsOf,
  arg,
  argProblem,
  argsProblem,
  argUsage,
  argValueFromWord,
} from "./args.js";
import { PluginDefinitionError } from "./definition-error.js";

describe("arg", () => {
  it("yields plain descriptions the console can serialize", () => {
    expect(arg.text({ about: "who", positional: true, max: 80 })).toEqual({
      type: "text",
      about: "who",
      optional: false,
      positional: true,
      max: 80,
    });
    expect(arg.text({ optional: true, secret: true })).toEqual({
      type: "text",
      optional: true,
      positional: false,
      secret: true,
    });
    expect(arg.number({ min: 1, max: 50, integer: true })).toEqual({
      type: "number",
      optional: false,
      positional: false,
      min: 1,
      max: 50,
      integer: true,
    });
    expect(arg.enum(["a", "b"])).toEqual({
      type: "enum",
      optional: false,
      positional: false,
      options: ["a", "b"],
    });
    expect(arg.record("requests")).toEqual({
      type: "record",
      optional: false,
      positional: false,
      collection: "requests",
    });
    expect(arg.list(arg.person(), { max: 5 })).toEqual({
      type: "list",
      optional: false,
      positional: false,
      max: 5,
      of: { type: "person", optional: false, positional: false },
    });
    expect(JSON.parse(JSON.stringify(arg.file({ optional: true })))).toEqual({
      type: "file",
      optional: true,
      positional: false,
    });
  });

  it("carries the value's type and whether it may be left out", () => {
    const definitions = {
      from: arg.day({ positional: true }),
      reason: arg.text({ optional: true }),
      days: arg.number(),
      kind: arg.enum(["paid", "unpaid"]),
      people: arg.list(arg.person()),
    };
    const required: ArgDefinition<string, false> = definitions.from;
    const optional: ArgDefinition<string, true> = definitions.reason;
    const args: ArgsOf<typeof definitions> = {
      from: "2026-11-01",
      days: 2,
      kind: "paid",
      people: [{ id: "p", login: "alice", name: null }],
    };
    expect(required.optional).toBe(false);
    expect(optional.optional).toBe(true);
    expect(args.reason).toBeUndefined();
  });

  it("refuses what is not an argument", () => {
    expect(() => arg.enum([] as unknown as ["a"])).toThrow(PluginDefinitionError);
    expect(() => arg.enum(["a", "a"])).toThrow(PluginDefinitionError);
    expect(() => arg.record("Requests")).toThrow(PluginDefinitionError);
    expect(() => arg.list(arg.list(arg.text()))).toThrow(PluginDefinitionError);
    expect(() => arg.list(arg.text({ optional: true }))).toThrow(PluginDefinitionError);
    expect(() => arg.number({ min: 2, max: 1 })).toThrow(PluginDefinitionError);
    expect(() => arg.text({ about: "two\nlines" })).toThrow(PluginDefinitionError);
  });
});

describe("argProblem", () => {
  it("names the first thing wrong with a value, or nothing", () => {
    expect(argProblem("to", arg.text({ max: 3 }), "abcd")).toBe("to is over 3 characters");
    expect(argProblem("to", arg.text(), "a\nb")).toBe("to is one line");
    expect(argProblem("to", arg.text(), undefined)).toBe("to is required");
    expect(argProblem("to", arg.text({ optional: true }), undefined)).toBeUndefined();
    expect(argProblem("day", arg.day(), "2026-02-30")).toBeUndefined();
    expect(argProblem("day", arg.day(), "2026-13-01")).toBe("day is not a day as YYYY-MM-DD");
    expect(argProblem("n", arg.number({ integer: true }), 1.5)).toBe("n is not a whole number");
    expect(argProblem("n", arg.number({ min: 1 }), 0)).toBe("n is below 1");
    expect(argProblem("n", arg.number(), "1")).toBe("n is not a number");
    expect(argProblem("ok", arg.boolean(), "yes")).toBe("ok is true or false");
    expect(argProblem("kind", arg.enum(["a", "b"]), "c")).toBe("kind is one of a, b");
    expect(argProblem("who", arg.person(), "")).toBe("who is not valid");
    expect(argProblem("who", arg.person(), "me")).toBeUndefined();
    expect(argProblem("ids", arg.list(arg.number()), [1, "2"])).toBe("ids[1] is not a number");
    expect(argProblem("ids", arg.list(arg.number(), { max: 1 }), [1, 2])).toBe(
      "ids has more than 1 items",
    );
    expect(argProblem("ids", arg.list(arg.number()), "1,2")).toBe("ids is a list");
  });

  it("checks a whole set, unknown names first", () => {
    const definitions = { from: arg.day(), reason: arg.text({ optional: true }) };
    expect(argsProblem(definitions, { from: "2026-11-01" })).toBeUndefined();
    expect(argsProblem(definitions, { from: "2026-11-01", until: "x" })).toBe(
      "until is not an argument of this command",
    );
    expect(argsProblem(definitions, {})).toBe("from is required");
  });
});

describe("argValueFromWord", () => {
  it("reads numbers, booleans and lists from the command line's words", () => {
    expect(argValueFromWord(arg.number(), "12")).toBe(12);
    expect(argValueFromWord(arg.number(), "-1.5")).toBe(-1.5);
    expect(argValueFromWord(arg.number(), "twelve")).toBe("twelve");
    expect(argValueFromWord(arg.boolean(), "")).toBe(true);
    expect(argValueFromWord(arg.boolean(), "false")).toBe(false);
    expect(argValueFromWord(arg.list(arg.number()), "1, 2,3,")).toEqual([1, 2, 3]);
    expect(argValueFromWord(arg.list(arg.text()), "a,b")).toEqual(["a", "b"]);
    expect(argValueFromWord(arg.text(), " kept as is ")).toBe(" kept as is ");
  });
});

describe("argUsage", () => {
  it("writes the form help prints", () => {
    expect(argUsage("from", arg.day({ positional: true }))).toBe("<from>");
    expect(argUsage("to", arg.day())).toBe("--to <day>");
    expect(argUsage("reason", arg.text({ optional: true }))).toBe("[--reason <text>]");
    expect(argUsage("all", arg.boolean({ optional: true }))).toBe("[--all]");
    expect(argUsage("people", arg.list(arg.person()))).toBe("--people <person,...>");
  });
});
