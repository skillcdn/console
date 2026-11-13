import { type DestinationStream, type Logger, pino } from "pino";
import type { Role } from "./roles.js";

export type { Logger };

/** The most characters of an error's message, or of a statement, a line keeps. */
const MOST_ERROR_WORDS = 500;
/** How far a chain of causes is followed. */
const DEEPEST_CAUSE = 5;
/** The errors gathered into one that a line names at most. */
const MOST_GATHERED = 5;

/**
 * What an error may say of itself in a line besides its message: what kind it is and where it
 * came from, as a code or a name. Never a field that quotes what a statement was given, the
 * driver's `detail` and `where`, the ORM's `params`.
 */
const TOLD_FIELDS = [
  "code",
  "kind",
  "status",
  "statusCode",
  "errno",
  "syscall",
  "severity",
  "schema",
  "table",
  "column",
  "constraint",
  "routine",
] as const;

/** Where the ORM's message of a failed query goes on to what the statement was given. */
const PARAMS_FROM = "\nparams:";

const bounded = (words: string): string =>
  words.length > MOST_ERROR_WORDS ? `${words.slice(0, MOST_ERROR_WORDS)}…` : words;

/**
 * An error as a log line keeps it: its name, its message, its code, where it was thrown from
 * and its causes, and nothing a statement was given. A query that fails is thrown by the ORM with
 * every value bound to it, in its message and beside it, and the driver quotes the row in its
 * own `detail`: the words of a comment, an agent's conversation, an address. A line keeps the
 * statement, whose values are placeholders, and the codes that say what went wrong.
 */
export function errorForLog(value: unknown, depth = 0): unknown {
  if (!(value instanceof Error)) {
    if (typeof value === "string") {
      return bounded(value);
    }
    // What was thrown and is no error says nothing of itself here: its fields are unknown.
    return typeof value === "object" && value !== null
      ? { type: value.constructor?.name ?? "Object", message: "what was thrown is no error" }
      : value;
  }
  const whole = typeof value.message === "string" ? value.message : "";
  const at = whole.indexOf(PARAMS_FROM);
  const message = bounded(at < 0 ? whole : whole.slice(0, at));
  // The stack begins with the message whole: only where it was thrown from is kept of it.
  const frames = (typeof value.stack === "string" ? value.stack : "")
    .split("\n")
    .filter((line) => /^\s+at /.test(line));
  const said: Record<string, unknown> = {
    type: value.name,
    message,
    stack: [`${value.name}: ${message}`, ...frames].join("\n"),
  };
  const fields = value as unknown as Readonly<Record<string, unknown>>;
  for (const field of TOLD_FIELDS) {
    const told = fields[field];
    if (typeof told === "number" || typeof told === "boolean") {
      said[field] = told;
    } else if (typeof told === "string") {
      said[field] = bounded(told);
    }
  }
  if (depth < DEEPEST_CAUSE) {
    if (value.cause !== undefined && value.cause !== null) {
      said.cause = errorForLog(value.cause, depth + 1);
    }
    if (value instanceof AggregateError) {
      said.errors = value.errors
        .slice(0, MOST_GATHERED)
        .map((error) => errorForLog(error, depth + 1));
    }
  }
  return said;
}

/**
 * JSON logs to stdout. Callers log ids, names and codes, never content or credentials; the
 * redaction below is the second fence, for objects that carry more than was meant to be logged,
 * and an error is written as {@link errorForLog} keeps it.
 */
export function createLogger(options: {
  readonly level: string;
  readonly role: Role;
  /** Where the lines go: standard output unless said, which a test reads them from. */
  readonly destination?: DestinationStream | undefined;
}): Logger {
  const settings = {
    level: options.level,
    base: { role: options.role },
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: { err: (error: unknown) => errorForLog(error) },
    redact: {
      paths: [
        "authorization",
        "cookie",
        "token",
        "*.authorization",
        "*.cookie",
        "*.token",
        "*.headers.authorization",
        "*.headers.cookie",
        "*.headers.set-cookie",
        "*.connectionString",
        "*.url",
      ],
      censor: "[redacted]",
    },
  };
  return options.destination === undefined ? pino(settings) : pino(settings, options.destination);
}
