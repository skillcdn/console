import {
  isReferenceRules,
  REFERENCE_RULES,
  RULES_PATH,
  RULES_TITLE,
  type RulesSource,
} from "@skillcdn/console/api";
import type { Database } from "../client.js";
import {
  type DocumentRecord,
  type DocumentScope,
  getDocument,
  setArchived,
  writeDocument,
} from "./documents.js";
import type { Actor } from "./events.js";

// The rules of the board (ADR-0023): a page at `rules`, the workspace's own or a project's,
// kept as any page is, with its versions, and read apart. The workspace's rules are the
// console's own until an administrator writes the organization's; a project adds its own or
// none. Nothing of the console's own is copied into a row: it is answered as it stands, and
// a write that would copy it writes nothing, so that it keeps following the console's version.

export interface RulesRecord {
  readonly source: RulesSource;
  /** The rules as they hold; nothing for a project that adds none. */
  readonly body: string | undefined;
  /** The page written, or nothing for the console's own and for none. */
  readonly page: DocumentRecord | undefined;
}

/** What holds in a scope: the page written and not put away; else the console's own at the workspace, none in a project. */
export async function readRules(database: Database, scope: DocumentScope): Promise<RulesRecord> {
  const page = await getDocument(database, scope, RULES_PATH);
  if (page !== undefined && page.archivedAt === undefined) {
    return { source: "written", body: page.body, page };
  }
  return scope.projectId === null
    ? { source: "reference", body: REFERENCE_RULES, page: undefined }
    : { source: "none", body: undefined, page: undefined };
}

/**
 * Writes the rules of a scope as a version of their page, bringing the page back when it was
 * put away. At the workspace, the console's own rules sent as they are are never written:
 * a copy would stop following the console's version. With none written they change nothing;
 * with the organization's written they put its page away, so that the console's own hold.
 */
export async function writeRules(
  database: Database,
  input: {
    readonly scope: DocumentScope;
    readonly actor: Actor;
    readonly body: string;
    readonly baseVersion?: number | undefined;
    readonly maxVersions: number;
    readonly now: Date;
  },
): Promise<RulesRecord> {
  const { scope, body } = input;
  if (scope.projectId === null && isReferenceRules(body)) {
    return archiveRules(database, { scope, actor: input.actor, now: input.now });
  }
  await writeDocument(database, {
    scope,
    actor: input.actor,
    path: RULES_PATH,
    title: RULES_TITLE,
    body,
    baseVersion: input.baseVersion,
    restoreArchived: true,
    maxVersions: input.maxVersions,
    now: input.now,
  });
  return readRules(database, scope);
}

/** Puts the rules written in a scope away, so that the console's own hold again, or none; nothing when none are written. */
export async function archiveRules(
  database: Database,
  input: { readonly scope: DocumentScope; readonly actor: Actor; readonly now: Date },
): Promise<RulesRecord> {
  const current = await readRules(database, input.scope);
  if (current.source === "written") {
    await setArchived(database, {
      scope: input.scope,
      actor: input.actor,
      path: RULES_PATH,
      archived: true,
      now: input.now,
    });
  }
  return readRules(database, input.scope);
}
