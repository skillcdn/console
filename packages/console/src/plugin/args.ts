// The arguments of a plugin's commands and queries (docs/specs/plugins.md, "The server module"):
// each defined once, as data the console parses command lines against, writes help from and draws
// forms from, and as a type the command's `run` receives. A definer yields a plain object; what
// crosses from the plugin's thread to the console is exactly that object.
import { PluginDefinitionError } from "./definition-error.js";
import { MAX_PLUGIN_ABOUT_LENGTH, MAX_PLUGIN_OPTIONS } from "./limits.js";
import { PLUGIN_KEY_PATTERN } from "./manifest.js";

export const ARG_TYPES = [
  "text",
  "markdown",
  "day",
  "number",
  "boolean",
  "enum",
  "person",
  "project",
  "record",
  "list",
  "file",
] as const;

export type ArgType = (typeof ARG_TYPES)[number];

/** An argument as the console reads it: what every definer yields, and what help and the parser go by. */
export interface ArgDescription {
  readonly type: ArgType;
  /** One line, shown in help. */
  readonly about?: string;
  /** Left out, the argument is `undefined`; else the command refuses without it. */
  readonly optional: boolean;
  /** Given by position, in declaration order, before the flags; else as `--<name> <value>`. */
  readonly positional: boolean;
  /** A text hidden in the event the command leaves. */
  readonly secret?: boolean;
  /** The most characters of a text, the most of a number, or the most items of a list. */
  readonly max?: number;
  /** The least of a number. */
  readonly min?: number;
  /** A number that is whole. */
  readonly integer?: boolean;
  /** The words an `enum` takes. */
  readonly options?: readonly string[];
  /** The collection a `record` names an id of. */
  readonly collection?: string;
  /** What each item of a `list` is. */
  readonly of?: ArgDescription;
}

/**
 * A description that also carries, in its type alone, the value `run` receives and whether it
 * may be left out: `__value` and `__optional` are never set. They are kept apart from the fields
 * the console reads, so that a definer's result infers from what was asked of it and not from
 * where it is placed.
 */
export interface ArgDefinition<T = unknown, Optional extends boolean = boolean>
  extends ArgDescription {
  readonly __value?: T;
  readonly __optional?: Optional;
}

export type ArgDefinitions = Readonly<Record<string, ArgDescription>>;

/** The value an argument's definition stands for. */
export type ArgValue<D> = D extends ArgDefinition<infer T, boolean> ? T : unknown;

/** True for a definer's result with `optional: true`; a bare description is required. */
type IsOptional<D> =
  D extends ArgDefinition<unknown, true>
    ? D extends ArgDefinition<unknown, false>
      ? false
      : true
    : false;

type RequiredKeys<A extends ArgDefinitions> = {
  [K in keyof A]: IsOptional<A[K]> extends true ? never : K;
}[keyof A];
type OptionalKeys<A extends ArgDefinitions> = {
  [K in keyof A]: IsOptional<A[K]> extends true ? K : never;
}[keyof A];

/** The arguments `run` receives, from their definitions: the optional ones may be left out. */
export type ArgsOf<A extends ArgDefinitions> = {
  readonly [K in RequiredKeys<A>]: ArgValue<A[K]>;
} & {
  readonly [K in OptionalKeys<A>]?: ArgValue<A[K]>;
};

/** A person as an argument resolves to: the console found them among those the caller may see. */
export interface PluginPersonRef {
  readonly id: string;
  readonly login: string;
  readonly name: string | null;
}

/** A project as an argument resolves to: one the caller may see. */
export interface PluginProjectRef {
  readonly id: string;
  readonly key: string;
  readonly name: string;
}

/** A file as a command receives it: uploaded first, held for an hour, attached to a record by the plugin. */
export interface PluginFileHandle {
  readonly handle: string;
  readonly name: string;
  readonly type: string;
  readonly bytes: number;
}

interface CommonOptions<O extends boolean> {
  readonly about?: string;
  readonly positional?: boolean;
  readonly optional?: O;
}

function common<O extends boolean>(
  options: CommonOptions<O> | undefined,
): {
  about?: string;
  optional: O;
  positional: boolean;
} {
  const about = options?.about;
  if (
    about !== undefined &&
    (about.length === 0 || about.length > MAX_PLUGIN_ABOUT_LENGTH || /[\r\n]/.test(about))
  ) {
    throw new PluginDefinitionError([
      `an argument's about is one line of 1 to ${MAX_PLUGIN_ABOUT_LENGTH} characters`,
    ]);
  }
  return {
    ...(about === undefined ? {} : { about }),
    optional: (options?.optional ?? false) as O,
    positional: options?.positional ?? false,
  };
}

function bound(name: string, value: number | undefined, integer: boolean): void {
  if (value !== undefined && (!Number.isFinite(value) || (integer && !Number.isInteger(value)))) {
    throw new PluginDefinitionError([`${name} is not a ${integer ? "whole " : ""}number`]);
  }
}

/** The definers: `arg.text({ max: 200 })`, `arg.day({ positional: true })`, `arg.list(arg.person())`. */
export const arg = {
  /** A line of text, up to `max` characters; `secret` hides it in the event the command leaves. */
  text<O extends boolean = false>(
    options?: CommonOptions<O> & { readonly max?: number; readonly secret?: boolean },
  ): ArgDefinition<string, O> {
    bound("max", options?.max, true);
    return {
      type: "text",
      ...common(options),
      ...(options?.max === undefined ? {} : { max: options.max }),
      ...(options?.secret === true ? { secret: true } : {}),
    };
  },
  /** Markdown, with its line breaks, up to `max` characters. */
  markdown<O extends boolean = false>(
    options?: CommonOptions<O> & { readonly max?: number },
  ): ArgDefinition<string, O> {
    bound("max", options?.max, true);
    return {
      type: "markdown",
      ...common(options),
      ...(options?.max === undefined ? {} : { max: options.max }),
    };
  },
  /** A day as `YYYY-MM-DD`. */
  day<O extends boolean = false>(options?: CommonOptions<O>): ArgDefinition<string, O> {
    return { type: "day", ...common(options) };
  },
  /** A number, within `min` and `max`, whole where `integer`. */
  number<O extends boolean = false>(
    options?: CommonOptions<O> & {
      readonly min?: number;
      readonly max?: number;
      readonly integer?: boolean;
    },
  ): ArgDefinition<number, O> {
    bound("min", options?.min, false);
    bound("max", options?.max, false);
    if (options?.min !== undefined && options.max !== undefined && options.min > options.max) {
      throw new PluginDefinitionError(["min is above max"]);
    }
    return {
      type: "number",
      ...common(options),
      ...(options?.min === undefined ? {} : { min: options.min }),
      ...(options?.max === undefined ? {} : { max: options.max }),
      ...(options?.integer === true ? { integer: true } : {}),
    };
  },
  /** `true` or `false`; on the command line, `--<name>` alone is `true`. */
  boolean<O extends boolean = false>(options?: CommonOptions<O>): ArgDefinition<boolean, O> {
    return { type: "boolean", ...common(options) };
  },
  /** One of the words given. */
  enum<const V extends readonly [string, ...string[]], O extends boolean = false>(
    values: V,
    options?: CommonOptions<O>,
  ): ArgDefinition<V[number], O> {
    if (
      values.length === 0 ||
      values.length > MAX_PLUGIN_OPTIONS ||
      new Set(values).size !== values.length
    ) {
      throw new PluginDefinitionError([`an enum takes 1 to ${MAX_PLUGIN_OPTIONS} different words`]);
    }
    for (const value of values) {
      if (value.length === 0 || value.length > 64 || /\s/.test(value)) {
        throw new PluginDefinitionError([
          `the enum word "${value}" is not one word of up to 64 characters`,
        ]);
      }
    }
    return { type: "enum", ...common(options), options: [...values] };
  },
  /** A person: a login or `me` on the command line, resolved by the console to one the caller may see. */
  person<O extends boolean = false>(options?: CommonOptions<O>): ArgDefinition<PluginPersonRef, O> {
    return { type: "person", ...common(options) };
  },
  /** A project: a key the caller may see. */
  project<O extends boolean = false>(
    options?: CommonOptions<O>,
  ): ArgDefinition<PluginProjectRef, O> {
    return { type: "project", ...common(options) };
  },
  /** The id of a record of the collection named, one of this plugin's. */
  record<O extends boolean = false>(
    collection: string,
    options?: CommonOptions<O>,
  ): ArgDefinition<string, O> {
    if (!PLUGIN_KEY_PATTERN.test(collection)) {
      throw new PluginDefinitionError([
        `arg.record names the collection "${collection}", which is not a key`,
      ]);
    }
    return { type: "record", ...common(options), collection };
  },
  /** Several of the inner argument: the flag repeated, or commas between; up to `max` items. */
  list<D extends ArgDefinition, O extends boolean = false>(
    of: D,
    options?: CommonOptions<O> & { readonly max?: number },
  ): ArgDefinition<ArgValue<D>[], O> {
    if (of.type === "list" || of.type === "file" || of.type === "markdown") {
      throw new PluginDefinitionError([`a list of ${of.type} is not an argument`]);
    }
    if (of.optional || of.positional) {
      throw new PluginDefinitionError([
        "the items of a list are neither optional nor positional themselves",
      ]);
    }
    bound("max", options?.max, true);
    return {
      type: "list",
      ...common(options),
      ...(options?.max === undefined ? {} : { max: options.max }),
      of,
    };
  },
  /** A file: what `--file <path>` or `-` carried, uploaded first and handed as a handle. */
  file<O extends boolean = false>(
    options?: Omit<CommonOptions<O>, "positional">,
  ): ArgDefinition<PluginFileHandle, O> {
    return { type: "file", ...common(options) };
  },
};

const DAY = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const DEFAULT_TEXT_MAX = 2000;
const DEFAULT_MARKDOWN_MAX = 20_000;
const DEFAULT_LIST_MAX = 100;

/**
 * The problem with a value for an argument, as it arrives on the wire before the console
 * resolves it: a person is a login or `me`, a project a key, a record an id, a file a handle, each
 * a string. Nothing when the value fits.
 */
export function argProblem(
  name: string,
  description: ArgDescription,
  value: unknown,
): string | undefined {
  if (value === undefined) {
    return description.optional ? undefined : `${name} is required`;
  }
  switch (description.type) {
    case "text":
    case "markdown": {
      if (typeof value !== "string") {
        return `${name} is not text`;
      }
      const max =
        description.max ?? (description.type === "text" ? DEFAULT_TEXT_MAX : DEFAULT_MARKDOWN_MAX);
      if (value.length > max) {
        return `${name} is over ${max} characters`;
      }
      if (description.type === "text" && /[\r\n]/.test(value)) {
        return `${name} is one line`;
      }
      return undefined;
    }
    case "day":
      return typeof value === "string" && DAY.test(value)
        ? undefined
        : `${name} is not a day as YYYY-MM-DD`;
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return `${name} is not a number`;
      }
      if (description.integer === true && !Number.isInteger(value)) {
        return `${name} is not a whole number`;
      }
      if (description.min !== undefined && value < description.min) {
        return `${name} is below ${description.min}`;
      }
      if (description.max !== undefined && value > description.max) {
        return `${name} is above ${description.max}`;
      }
      return undefined;
    }
    case "boolean":
      return typeof value === "boolean" ? undefined : `${name} is true or false`;
    case "enum":
      return typeof value === "string" && (description.options ?? []).includes(value)
        ? undefined
        : `${name} is one of ${(description.options ?? []).join(", ")}`;
    case "person":
    case "project":
    case "record":
    case "file":
      return typeof value === "string" && value.length > 0 && value.length <= 254
        ? undefined
        : `${name} is not valid`;
    case "list": {
      if (!Array.isArray(value)) {
        return `${name} is a list`;
      }
      const max = description.max ?? DEFAULT_LIST_MAX;
      if (value.length > max) {
        return `${name} has more than ${max} items`;
      }
      const of = description.of;
      if (of === undefined) {
        return `${name} has no item type`;
      }
      for (const [index, item] of value.entries()) {
        const problem = argProblem(`${name}[${index}]`, of, item);
        if (problem !== undefined) {
          return problem;
        }
      }
      return undefined;
    }
    default:
      return `${name} has a type the console does not know`;
  }
}

/** The first problem with a set of values against their definitions, unknown names included; nothing when all fit. */
export function argsProblem(
  definitions: Readonly<Record<string, ArgDescription>>,
  values: Readonly<Record<string, unknown>>,
): string | undefined {
  for (const name of Object.keys(values)) {
    if (!(name in definitions)) {
      return `${name} is not an argument of this command`;
    }
  }
  for (const [name, description] of Object.entries(definitions)) {
    const problem = argProblem(name, description, values[name]);
    if (problem !== undefined) {
      return problem;
    }
  }
  return undefined;
}

/**
 * A word from the command line as the value an argument takes: a number read, a boolean read,
 * a list split at commas; text as it is. Nothing the word cannot be is a problem `argProblem`
 * then names.
 */
export function argValueFromWord(description: ArgDescription, word: string): unknown {
  switch (description.type) {
    case "number": {
      const trimmed = word.trim();
      return /^-?\d+(?:\.\d+)?$/.test(trimmed) ? Number(trimmed) : word;
    }
    case "boolean":
      return word === "true" || word === "" ? true : word === "false" ? false : word;
    case "list": {
      const of = description.of;
      return word
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .map((item) => (of === undefined ? item : argValueFromWord(of, item)));
    }
    default:
      return word;
  }
}

/** The words of a command line as the values of a command's arguments, or the first word that does not fit. */
export type ParsedArgv =
  | { readonly values: Record<string, unknown>; readonly problem?: undefined }
  | { readonly problem: string; readonly values?: undefined };

/**
 * The words of a command line as the arguments of a command or a query, by its definitions
 * (docs/specs/plugins.md, "The command"): the positional arguments in declaration order, one word
 * each, among the flags, `--name value` or `--name=value`; a boolean flag alone means true; a
 * list is a flag given again, or commas between its items; `--` ends the flags. An argument of
 * type `file` takes the handles of the files the command uploaded, one each in declaration
 * order, where none is named. The values are then checked with `argsProblem`.
 */
export function parseArgv(
  definitions: Readonly<Record<string, ArgDescription>>,
  argv: readonly string[],
  files: readonly string[] = [],
): ParsedArgv {
  const values: Record<string, unknown> = {};
  const positionals = Object.entries(definitions).filter(
    ([, description]) => description.positional,
  );
  let position = 0;
  let flagsEnded = false;
  const put = (name: string, description: ArgDescription, word: string): string | undefined => {
    const value = argValueFromWord(description, word);
    if (description.type === "list") {
      const current = values[name];
      values[name] = Array.isArray(current) ? [...current, ...(value as unknown[])] : value;
      return undefined;
    }
    if (Object.hasOwn(values, name)) {
      return `${name} is given more than once`;
    }
    values[name] = value;
    return undefined;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const word = argv[index] ?? "";
    if (!flagsEnded && word === "--") {
      flagsEnded = true;
      continue;
    }
    if (!flagsEnded && word.startsWith("--") && word.length > 2) {
      const equals = word.indexOf("=");
      const name = equals < 0 ? word.slice(2) : word.slice(2, equals);
      const description = Object.hasOwn(definitions, name) ? definitions[name] : undefined;
      if (description === undefined) {
        return { problem: `--${name} is not an argument of this command` };
      }
      let given: string;
      if (equals >= 0) {
        given = word.slice(equals + 1);
      } else if (description.type === "boolean") {
        given = "";
      } else {
        const next = argv[index + 1];
        if (next === undefined) {
          return { problem: `--${name} needs a value` };
        }
        given = next;
        index += 1;
      }
      const problem = put(name, description, given);
      if (problem !== undefined) {
        return { problem };
      }
      continue;
    }
    const slot = positionals[position];
    if (slot === undefined) {
      return {
        problem:
          positionals.length === 0
            ? `${JSON.stringify(word)} is one word too many: the command takes no positional argument, only flags`
            : `${JSON.stringify(word)} is one word too many: the command takes ${positionals.length} positional argument${positionals.length === 1 ? "" : "s"}`,
      };
    }
    const problem = put(slot[0], slot[1], word);
    if (problem !== undefined) {
      return { problem };
    }
    position += 1;
  }
  let taken = 0;
  let slots = 0;
  for (const [name, description] of Object.entries(definitions)) {
    if (description.type !== "file") {
      continue;
    }
    slots += 1;
    if (!Object.hasOwn(values, name) && taken < files.length) {
      values[name] = files[taken];
      taken += 1;
    }
  }
  if (taken < files.length) {
    return {
      problem:
        slots === 0
          ? "the command takes no file"
          : `the command takes ${slots} file${slots === 1 ? "" : "s"}, not ${files.length}`,
    };
  }
  return { values };
}

/** The usage of an argument, as help prints it: `<from>` for a positional, `--to <day>` for a flag, in brackets where optional. */
export function argUsage(name: string, description: ArgDescription): string {
  const placeholder =
    description.type === "list" ? `${description.of?.type ?? "item"},...` : description.type;
  const form =
    description.type === "boolean" && !description.positional
      ? `--${name}`
      : description.positional
        ? `<${name}>`
        : `--${name} <${placeholder}>`;
  return description.optional ? `[${form}]` : form;
}
