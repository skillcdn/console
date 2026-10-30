// The REST contract between the command and the console, held to a snapshot (ADR-0038, point
// 4; ADR-0043). Every `rest*Schema` of the package, as the console answers it (`output`) or
// takes it (`input`), is written as JSON Schema into scripts/rest-schemas.snapshot.json with
// the floors it was taken at. Part of `pnpm check`, after the build: the schemas as built are
// compared with the snapshot, and a change that breaks what passes between the two sides fails
// the check here, instead of failing an older command on an answer it cannot read. A change
// that only adds passes: the other side ignores it. When the floors move, the snapshot is taken
// again in the same change (`pnpm snapshot:rest`, this script with --write). Reads the built
// package and the snapshot; no network.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const SNAPSHOT = "scripts/rest-schemas.snapshot.json";
const PACKAGE = "packages/console";
const COMPAT = `${PACKAGE}/src/compat.ts`;
const RETAKE = "pnpm snapshot:rest";
const NAME = /^rest[A-Za-z]+Schema$/;
/** What the command sends and the console takes; everything else is what the console answers. */
const INPUT = /(Input|Patch)Schema$/;
/** The bounds a schema narrows or widens by: the lower ones and the upper ones. */
const LOWER = ["minLength", "minimum", "exclusiveMinimum", "minItems"];
const UPPER = ["maxLength", "maximum", "exclusiveMaximum", "maxItems"];

const built = (file) => import(pathToFileURL(resolve(PACKAGE, "dist", file)).href);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ioOf = (name) => (INPUT.test(name) ? "input" : "output");

const [{ z }, schemas, compat] = await Promise.all([
  import(pathToFileURL(resolve(PACKAGE, "node_modules/zod/index.js")).href),
  built("schemas.js"),
  built("compat.js"),
]);

/** The floors as the package holds them: the console's on the command, and the command's on the console. */
const floors = {
  client: compat.CLIENT_POLICY.atLeast ?? "0.0.0",
  console: compat.CONSOLE_AT_LEAST,
};

/** Every REST schema of the package as JSON Schema, by name, in a stable order. */
function contractOf() {
  const contract = {};
  for (const name of Object.keys(schemas).sort()) {
    const schema = schemas[name];
    if (NAME.test(name) && typeof schema === "object" && schema !== null && "_zod" in schema) {
      contract[name] = z.toJSONSchema(schema, { io: ioOf(name), unrepresentable: "any" });
    }
  }
  return contract;
}

/** The schema without its `null` alternative, and whether it had one. */
function unnull(schema) {
  if (Array.isArray(schema.type) && schema.type.includes("null")) {
    const types = schema.type.filter((type) => type !== "null");
    return { schema: { ...schema, type: types.length === 1 ? types[0] : types }, nullable: true };
  }
  if (Array.isArray(schema.anyOf)) {
    const rest = schema.anyOf.filter((member) => !same(member, { type: "null" }));
    if (rest.length < schema.anyOf.length) {
      const inner = rest.length === 1 ? rest[0] : { ...schema, anyOf: rest };
      return { schema: inner, nullable: true };
    }
  }
  return { schema, nullable: false };
}

/** What kind of value a schema is, as far as the comparison tells kinds apart. */
function kindOf(schema) {
  if (schema.$ref !== undefined) {
    return `ref ${schema.$ref}`;
  }
  if (schema.const !== undefined) {
    return "const";
  }
  if (Array.isArray(schema.enum)) {
    return "enum";
  }
  if (Array.isArray(schema.anyOf)) {
    return "union";
  }
  if (typeof schema.type === "string") {
    return schema.type;
  }
  return "any";
}

/**
 * What `after` breaks of `before` at `path`, written into `found`. An answer (`output`) is read
 * by an older command with the schema it has: it breaks when a field goes or is no longer
 * always there, may be null where it was not, changes its kind, gains a value of an enum or a
 * member of a union, or admits what the older reader's bounds refuse. An input (`input`) is
 * sent by an older command as its schema allows: it breaks when a field goes or becomes
 * required, stops taking null, changes its kind, loses a value or a member, or narrows its
 * bounds. Additions pass: the other side ignores them.
 */
function breaksOf(before, after, io, path, found) {
  const b = unnull(before);
  const a = unnull(after);
  if (io === "output" && !b.nullable && a.nullable) {
    found.push(`${path}: may be null now, which a reader of before refuses`);
  }
  if (io === "input" && b.nullable && !a.nullable) {
    found.push(`${path}: takes no null any more, which a sender of before may send`);
  }
  const kind = kindOf(b.schema);
  if (kind === "any") {
    return;
  }
  if (kind !== kindOf(a.schema)) {
    found.push(`${path}: ${kind} became ${kindOf(a.schema)}`);
    return;
  }
  switch (kind) {
    case "object":
      compareObjects(b.schema, a.schema, io, path, found);
      break;
    case "array":
      if (b.schema.items !== undefined && a.schema.items !== undefined) {
        breaksOf(b.schema.items, a.schema.items, io, `${path}[]`, found);
      }
      compareBounds(b.schema, a.schema, io, path, found);
      break;
    case "enum":
      compareValues(b.schema.enum, a.schema.enum, io, path, found);
      break;
    case "const":
      if (!same(b.schema.const, a.schema.const)) {
        found.push(
          `${path}: ${JSON.stringify(b.schema.const)} became ${JSON.stringify(a.schema.const)}`,
        );
      }
      break;
    case "union":
      compareMembers(b.schema.anyOf, a.schema.anyOf, io, path, found);
      break;
    case "string":
      compareBounds(b.schema, a.schema, io, path, found);
      for (const key of ["pattern", "format"]) {
        if (b.schema[key] !== undefined && b.schema[key] !== a.schema[key]) {
          found.push(`${path}: ${key} changed`);
        }
      }
      break;
    case "number":
    case "integer":
      compareBounds(b.schema, a.schema, io, path, found);
      break;
    default:
      break;
  }
}

function compareObjects(before, after, io, path, found) {
  const bp = before.properties ?? {};
  const ap = after.properties ?? {};
  const br = new Set(before.required ?? []);
  const ar = new Set(after.required ?? []);
  for (const key of Object.keys(bp)) {
    const at = `${path}.${key}`;
    if (!(key in ap)) {
      found.push(`${at}: removed`);
      continue;
    }
    if (io === "output" && br.has(key) && !ar.has(key)) {
      found.push(`${at}: no longer always there, which a reader of before expects`);
    }
    if (io === "input" && !br.has(key) && ar.has(key)) {
      found.push(`${at}: required now, which a sender of before leaves out`);
    }
    breaksOf(bp[key], ap[key], io, at, found);
  }
  if (io === "input") {
    for (const key of Object.keys(ap)) {
      if (!(key in bp) && ar.has(key)) {
        found.push(`${path}.${key}: added as required, which a sender of before leaves out`);
      }
    }
  }
  const bAdditional = before.additionalProperties;
  const aAdditional = after.additionalProperties;
  if (typeof bAdditional === "object" && typeof aAdditional === "object") {
    breaksOf(bAdditional, aAdditional, io, `${path}[*]`, found);
  }
}

/** Enum values: a reader has a fixed set, so an answer may not gain one; a sender may not lose one. */
function compareValues(before, after, io, path, found) {
  const was = new Set(before.map((value) => JSON.stringify(value)));
  const is = new Set(after.map((value) => JSON.stringify(value)));
  if (io === "output") {
    for (const value of is) {
      if (!was.has(value)) {
        found.push(`${path}: value ${value} added, which a reader of before refuses`);
      }
    }
  } else {
    for (const value of was) {
      if (!is.has(value)) {
        found.push(`${path}: value ${value} removed, which a sender of before may send`);
      }
    }
  }
}

/** Members of a union, compared whole: an answer may not gain one, a sender may not lose one. */
function compareMembers(before, after, io, path, found) {
  const has = (members, member) => members.some((other) => same(other, member));
  if (io === "output") {
    for (const member of after) {
      if (!has(before, member)) {
        found.push(`${path}: a member of the union was added, which a reader of before refuses`);
      }
    }
  } else {
    for (const member of before) {
      if (!has(after, member)) {
        found.push(`${path}: a member of the union was removed, which a sender of before may send`);
      }
    }
  }
}

/** Bounds: a sender may not be narrowed, a reader may not be widened past what it refuses. */
function compareBounds(before, after, io, path, found) {
  for (const key of LOWER) {
    const was = before[key];
    const is = after[key];
    const narrowed = is !== undefined && (was === undefined || is > was);
    const widened = was !== undefined && (is === undefined || is < was);
    if ((io === "input" && narrowed) || (io === "output" && widened)) {
      found.push(`${path}: ${key} ${was ?? "none"} became ${is ?? "none"}`);
    }
  }
  for (const key of UPPER) {
    const was = before[key];
    const is = after[key];
    const narrowed = is !== undefined && (was === undefined || is < was);
    const widened = was !== undefined && (is === undefined || is > was);
    if ((io === "input" && narrowed) || (io === "output" && widened)) {
      found.push(`${path}: ${key} ${was ?? "none"} became ${is ?? "none"}`);
    }
  }
}

const current = { floors, schemas: contractOf() };
const count = Object.keys(current.schemas).length;
const floorsOf = (taken) =>
  `console takes commands from ${taken.client}, command takes consoles from ${taken.console}`;

if (process.argv.includes("--write")) {
  writeFileSync(SNAPSHOT, `${JSON.stringify(current, null, 2)}\n`);
  process.stdout.write(
    `rest contract: ${count} schemas written to ${SNAPSHOT} at the floors (${floorsOf(floors)})\n`,
  );
  process.exit(0);
}

if (!existsSync(SNAPSHOT)) {
  process.stderr.write(`rest contract: no snapshot at ${SNAPSHOT}; take it with ${RETAKE}\n`);
  process.exit(1);
}
const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
if (!same(snapshot.floors, floors)) {
  process.stderr.write(
    `rest contract: the floors moved (${floorsOf(snapshot.floors)} -> ${floorsOf(floors)}) in ${COMPAT}: the snapshot is of the contract at the old floors. Take it again in the same change: ${RETAKE}\n`,
  );
  process.exit(1);
}
const found = [];
for (const [name, before] of Object.entries(snapshot.schemas)) {
  const after = current.schemas[name];
  if (after === undefined) {
    found.push(`${name}: removed`);
    continue;
  }
  breaksOf(before, after, ioOf(name), name, found);
}
if (found.length > 0) {
  process.stderr.write(
    `rest contract: ${found.length} change(s) break what passes between the command and the console, and the floors did not move:\n${found.map((line) => `  - ${line}`).join("\n")}\nA release that changes what passes between them raises the floor of the side it breaks for (ADR-0038): CLIENT_POLICY.atLeast in ${COMPAT} for a change an older command cannot read or send, CONSOLE_AT_LEAST for one the command needs of the console, to the version the pending changesets make, with a changeset that begins with Breaking:; then take the snapshot again: ${RETAKE}. Or undo the change.\n`,
  );
  process.exit(1);
}
process.stdout.write(
  `rest contract: ${count} schemas, within the snapshot at the floors (${floorsOf(floors)})\n`,
);
