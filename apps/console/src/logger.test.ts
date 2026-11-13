import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger, errorForLog } from "./logger.js";

// What an error leaves in a log line. A failed query carries everything it was given, the words
// of a comment, an agent's conversation, an address, and the logs are no place for any of it.

/** A logger whose lines are read back, each parsed. */
function reading() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString("utf8"));
      done();
    },
  });
  const logger = createLogger({ level: "info", role: "api", destination });
  return { logger, lines, parsed: () => lines.map((line) => JSON.parse(line) as unknown) };
}

const SECRET = ["sk", "live", "4f9a8b7c6d5e4f3a2b1c"].join("_");
const SAID = "Reconcile the ledger with what the bank said on Tuesday, then tell Alice.";

/** An error as the ORM throws one for a query that failed: the statement, what it was given, and the driver's own under it. */
function failedQuery(): Error {
  const driver = Object.assign(
    new Error('duplicate key value violates unique constraint "events_pkey"'),
    {
      name: "error",
      code: "23505",
      severity: "ERROR",
      detail: `Key (text)=(${SAID}) already exists.`,
      where: `COPY events, line 1: "${SECRET}"`,
      schema: "transcript",
      table: "events",
      constraint: "events_pkey",
      routine: "_bt_check_unique",
    },
  );
  const query = 'insert into "transcript"."events" ("session_id", "n", "text") values ($1, $2, $3)';
  const params = ["0199c4d8-0000-7000-8000-000000000001", 7, SAID, SECRET];
  return Object.assign(new Error(`Failed query: ${query}\nparams: ${params}`, { cause: driver }), {
    query,
    params,
  });
}

describe("what an error leaves in a log line", () => {
  it("keeps the statement and the codes of a failed query, and nothing it was given", () => {
    const { logger, lines, parsed } = reading();
    logger.error({ err: failedQuery(), requestId: "r1" }, "unhandled request error");
    expect(lines).toHaveLength(1);
    const [line] = lines;
    expect(line).not.toContain(SECRET);
    expect(line).not.toContain(SAID);
    expect(line).not.toContain("params");
    const [entry] = parsed() as [{ err: Record<string, unknown>; requestId: string }];
    expect(entry.requestId).toBe("r1");
    expect(entry.err).toMatchObject({
      type: "Error",
      message:
        'Failed query: insert into "transcript"."events" ("session_id", "n", "text") values ($1, $2, $3)',
      cause: {
        type: "error",
        message: 'duplicate key value violates unique constraint "events_pkey"',
        code: "23505",
        severity: "ERROR",
        schema: "transcript",
        table: "events",
        constraint: "events_pkey",
      },
    });
    // Where it was thrown from is kept, under the message as it is logged.
    expect(String(entry.err.stack)).toMatch(/^Error: Failed query: insert into [^\n]*\n\s+at /);
    expect(entry.err).not.toHaveProperty("params");
    expect(entry.err.cause).not.toHaveProperty("detail");
    expect(entry.err.cause).not.toHaveProperty("where");
  });

  it("keeps an error's own code and what kind it is, and bounds what it says", () => {
    const refused = Object.assign(new Error("the host did not answer"), {
      name: "ProviderError",
      code: "identity_provider.transient",
      kind: "transient",
      status: 503,
      body: SAID,
      headers: { authorization: SECRET },
    });
    expect(errorForLog(refused)).toMatchObject({
      type: "ProviderError",
      message: "the host did not answer",
      code: "identity_provider.transient",
      kind: "transient",
      status: 503,
    });
    expect(JSON.stringify(errorForLog(refused))).not.toContain(SECRET);
    expect(JSON.stringify(errorForLog(refused))).not.toContain(SAID);

    // A driver that quotes what it was given in its message is cut where a line is long enough.
    const long = new Error(`invalid input syntax for type integer: "${"9".repeat(5000)}"`);
    const said = errorForLog(long) as { message: string; stack: string };
    expect(said.message.length).toBeLessThanOrEqual(501);
    expect(said.stack).not.toContain("9".repeat(600));
  });

  it("follows the causes and the errors gathered into one, a few deep", () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5433"), {
      code: "ECONNREFUSED",
      errno: -111,
      syscall: "connect",
    });
    const all = new AggregateError([refused, failedQuery()], "");
    const said = errorForLog(new Error("the database could not be reached", { cause: all })) as {
      cause: { type: string; errors: { code?: string; message: string }[] };
    };
    expect(said.cause.type).toBe("AggregateError");
    expect(said.cause.errors[0]).toMatchObject({ code: "ECONNREFUSED", syscall: "connect" });
    expect(JSON.stringify(said)).not.toContain(SECRET);

    // A chain that never ends is followed a few steps and no further.
    const loop = new Error("round");
    (loop as { cause?: unknown }).cause = loop;
    expect(JSON.stringify(errorForLog(loop)).length).toBeLessThan(20_000);
  });

  it("says nothing of what was thrown and is no error, but that it is none", () => {
    expect(errorForLog("a word")).toBe("a word");
    expect(errorForLog(undefined)).toBeUndefined();
    const thrown = { params: [SECRET], said: SAID };
    expect(errorForLog(thrown)).toEqual({ type: "Object", message: "what was thrown is no error" });
  });
});
