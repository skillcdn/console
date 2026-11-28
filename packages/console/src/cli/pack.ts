import {
  type BrowseQuery,
  type CodePage,
  type DataQuery,
  type FileQuery,
  type FindQuery,
  type Pack,
  PackError,
  type RowsPage,
} from "@skillcdn/cli";
import {
  isReadmePath,
  parseAddress,
  parseRepoPath,
  parseSkillUri,
  type RestBrowse,
  type RestFile,
  type RestFind,
  type RestMount,
  type RestSkill as RestSkillPage,
  type ToolWords,
} from "@skillcdn/core";
import type { PackClient } from "../client.js";
import type { RestSkills } from "../schemas.js";
import type { SkillsStatus } from "../vocabulary.js";
import { commandLine, NO_LINE_TO_RUN } from "./command-words.js";

// The pack of the project, as the command prints it (ADR-0028, ADR-0031, ADR-0124): the console
// answers what the pack's REST API answered, in the shapes of @skillcdn/core, and the command
// hands those answers, as a pack, to the reads the skillcdn command itself prints with
// (`readPack` of @skillcdn/cli), naming the reads as its own commands. So an agent reads here
// what it would read over MCP, or with the skillcdn command, and a change of that command's text
// comes with its next version. What is here is the console's own: the pack made of the console's
// answers, the lines around a listing, and the words of a pack the console could not read,
// which is a project's or the organization's and whose token is the console's to hold.

/** How the results name the four reads of a pack read with `skills` and `skill`, so that an agent is told the command and not a tool. */
export const packWords = (skills: string, skill: string): ToolWords => ({
  browse: `${skills} <folder>`,
  search: `${skills} --search`,
  load: skill,
  read: `${skill} --file`,
});

/** The words of the project's pack, and the organization's: `console skills` and `console skill`. */
export const CONSOLE_WORDS: ToolWords = packWords("console skills", "console skill");

export const NO_ADDRESS = "No skills address: neither this project nor the console names one.";

/**
 * Whose pack a read is of, for the words of a read that did not happen: a project's, or the
 * organization's, which is what a command reads where no project is named (ADR-0113).
 */
export type PackOwner = "project" | "organization";

const NO_ORGANIZATION_ADDRESS =
  "No skills address: the console names none for the organization's skills, and no project is named here.";

const noAddress = (owner: PackOwner): string =>
  owner === "organization" ? NO_ORGANIZATION_ADDRESS : NO_ADDRESS;

/**
 * What a read of the organization's pack begins with: whose pack it is, since the command
 * would otherwise read as if a project had been named, and how a project's own is read.
 */
export const ORGANIZATION_PACK_LINE =
  "The organization's pack, since no project is named here: --project <key>, or a directory bound with console use <key>, reads a project's own.";

/** The words of a read that did not happen, by status, with what to do about it. */
const SKILLS_WORDS: Readonly<Record<Exclude<SkillsStatus, "none" | "ready">, string>> = {
  indexing: "The pack is still being indexed; ask again in a moment.",
  failed:
    "The pack could not be indexed, or this is a file the pack will not carry: too large, or not text.",
  not_found:
    "Nothing is served to the console at this address or path: it is not there, or the pack is private and the project holds no pack token for it (console project pack-token <key> --stdin, for an owner).",
  token_invalid:
    "The pack token the project holds no longer works at the deployment: an owner sets a new one (console project pack-token <key> --stdin).",
  unavailable: "The pack could not be reached; ask again later.",
};

/** The same, where the pack is the organization's: the token is the workspace's, an administrator's to set. */
const ORGANIZATION_WORDS: Readonly<Record<"not_found" | "token_invalid", string>> = {
  not_found:
    "Nothing is served to the console at this address or path: it is not there, or the organization's pack is private and the workspace holds no SkillCDN token for it (console workspace pack-token --connect, for an administrator).",
  token_invalid:
    "The SkillCDN token the workspace holds no longer works at the deployment: an administrator sets a new one (console workspace pack-token --connect).",
};

/** What every answer of the console about a pack says first: where it is, and how the read went. */
export type PackEnvelope = Pick<RestSkills, "address" | "source" | "page" | "status" | "refusal">;

/** One answer of the console to a read of a pack: the envelope, and the pack's own answer in it. */
export type PackAnswer = PackEnvelope & { readonly read: unknown };

/** The first line of an answer about the pack: what was read, where the pack is, and how it went. */
function head(what: string, answer: PackEnvelope): string {
  const where =
    answer.source === null ? "read from the console's machine" : `served by ${answer.source}`;
  return `${what} at ${answer.address}, ${where}: ${answer.status}`;
}

/**
 * Whether a refusal is the pack's answer to one read: a path with nothing at it, a read asked
 * wrong, a file it will not carry, in the pack's own code and words. The pack answered, so no
 * token is what is missing, and saying so would send an agent to mend a pack that is served.
 * Every other refusal is of the pack as a whole: nothing is served to the console at the
 * address, the token is no good there, the index is not there to read, or it was not reached.
 */
const ofOneRead = (answer: PackEnvelope): boolean =>
  answer.refusal !== null &&
  (answer.status === "not_found" || answer.status === "failed") &&
  !/^(mount|auth|index)\./.test(answer.refusal.code);

/**
 * A read the console could not make, of the pack as a whole, as the command says it on standard
 * error: that no address is named; or where the pack is and how it stands, the words of that
 * standing with whose token is missing, and the pack's own refusal when it gave one. `what` is
 * the read in a word: `skills`, `folder`, `search`, `skill`, `file`, `tables`, `code blocks`.
 */
export function refusalWords(
  what: string,
  answer: PackEnvelope,
  owner: PackOwner = "project",
): string {
  if (answer.status === "none" || answer.address === null) {
    return noAddress(owner);
  }
  const lines = [head(what, answer)];
  if (answer.status === "ready") {
    lines.push("Nothing was read.");
  } else {
    lines.push(
      owner === "organization" &&
        (answer.status === "not_found" || answer.status === "token_invalid")
        ? ORGANIZATION_WORDS[answer.status]
        : SKILLS_WORDS[answer.status],
    );
  }
  if (answer.refusal !== null) {
    lines.push(answer.refusal.message);
  }
  return lines.join("\n");
}

/**
 * A read of the pack as a whole that the console could not make: thrown by the pack made of the
 * console's answers, for the command to say in the console's words ({@link refusalWords}). A
 * refusal of one read, in the pack's own code and words, is a `PackError` instead, as the
 * skillcdn command's own pack throws one.
 */
export class PackRefusal extends Error {
  /** The read in a word, as the first line of the refusal names it. */
  readonly what: string;
  /** What the console answered. */
  readonly answer: PackAnswer;

  constructor(what: string, answer: PackAnswer) {
    super(`${what}: ${answer.status}`);
    this.name = "PackRefusal";
    this.what = what;
    this.answer = answer;
  }
}

type Ready<T> = Extract<T, { readonly status: "ready" }>;

/**
 * Every skill and document the address serves, as a search without words answers them, made
 * from what the pack says of itself in the one answer the console already has (ADR-0118, point
 * 5): the console's API takes no search without words, and a listing asked page by page through
 * a console that may be far would be several requests for the answer one gives. A folder's
 * README is marked as its overview by the rule @skillcdn/core exports. With `limit`, as many of
 * them from where `cursor` says, and the cursor of the next where more follow: the pages the
 * command prints a long listing in (ADR-0124) are cut here, from the one answer.
 */
function listingOf(
  mount: RestMount,
  page: { readonly cursor?: string | undefined; readonly limit?: number | undefined } = {},
): Ready<RestFind> {
  const { index } = mount;
  if (index.status !== "ready") {
    throw new PackError(503, `index.${index.status}`, "The pack is not ready to read.");
  }
  const items: Ready<RestFind>["items"] = [];
  for (const skill of index.skills) {
    items.push({
      kind: "skill",
      path: skill.path ?? (skill.directory === "" ? "SKILL.md" : `${skill.directory}/SKILL.md`),
      name: skill.name,
      directory: skill.directory,
      description: skill.description,
      translations: skill.translations,
      files: [],
      moreFiles: 0,
    });
  }
  for (const document of index.documents) {
    const path = parseRepoPath(document.path);
    items.push({
      kind: "document",
      path: document.path,
      title: document.title,
      summary: document.summary,
      skillDirectory: null,
      ...(path.ok && isReadmePath(path.value) ? { overview: true } : {}),
    });
  }
  const from = listingStart(page.cursor, mount.commit, items.length);
  const end =
    page.limit === undefined
      ? items.length
      : Math.min(items.length, from + Math.max(1, page.limit));
  return {
    status: "ready",
    query: null,
    commit: mount.commit,
    items: items.slice(from, end),
    diagnostics: index.diagnostics,
    // The listing the command prints is of the skills alone (SkillCDN 0.6.3): the documents
    // outside them are counted from these, with what reads them, and a page that ends before
    // the skills do says how many are left.
    totals: { skills: index.skills.length, documents: index.documents.length },
    nextCursor: end < items.length ? listingCursor(end, mount.commit) : null,
  };
}

/** What of a commit a cursor of the listing carries: enough to tell one index from the next. */
const commitMark = (commit: string): string => commit.replace(/[^0-9A-Za-z]/g, "").slice(0, 12);

/** The cursor of the listing's page that begins at `offset`, of the index at `commit`. */
const listingCursor = (offset: number, commit: string): string => `${offset}-${commitMark(commit)}`;

/**
 * Where the page a cursor names begins, or the start without one. A cursor is of one index, as
 * the pack's own are: one of another commit, or that is none, is refused in the pack's words, so
 * that a page never goes on from a listing in another order.
 */
function listingStart(cursor: string | undefined, commit: string, count: number): number {
  if (cursor === undefined) {
    return 0;
  }
  const match = /^([0-9]{1,7})-([0-9A-Za-z]{0,12})$/.exec(cursor);
  const offset = match === null ? Number.NaN : Number(match[1]);
  if (match === null || match[2] !== commitMark(commit) || offset < 1 || offset >= count) {
    throw new PackError(
      400,
      "request.invalid",
      "This continuation does not match the repository snapshot. Start again without a cursor.",
    );
  }
  return offset;
}

/**
 * A document's outline with the reads of its tables and its code blocks named as commands
 * (ADR-0100): where the console said an address of its own for one, the command that reads it,
 * `command` being the one the pack is read with, so that an agent is told what to run. Where the
 * path has no spelling both shells take whole, what to run is said in words, with why.
 */
function withDataCommands(read: Ready<RestBrowse>, command: string): Ready<RestBrowse> {
  const outline = read.outline;
  if (outline?.data === undefined) {
    return read;
  }
  const line = (flag: string): string =>
    commandLine(command, [flag, outline.path]) ??
    `${command} ${flag} with this file's path, quoted for your shell. ${NO_LINE_TO_RUN}`;
  return {
    ...read,
    outline: {
      ...outline,
      data: {
        ...(outline.data.rows === undefined ? {} : { rows: line("--rows") }),
        ...(outline.data.code === undefined ? {} : { code: line("--code") }),
      },
    },
  };
}

/**
 * How many pages of a skill, of tables or of code blocks one command follows before it stops:
 * far above what a pack holds, and the end of a read that would otherwise go round a console
 * that names the same cursor again.
 */
const MAX_PAGES = 64;

/** A pack made of the console's answers, which says what the console answered last. */
export interface ConsolePack extends Pack {
  /** The console's answer to the last read made of the pack: what `--json` prints around the pack's own answer, and what a refusal is said from. */
  answered(): PackAnswer | undefined;
}

/**
 * The pack `reader` reads, as the reads of the skillcdn command take one (ADR-0124): each read
 * asked of the console, and the pack's own answer taken out of the console's. `listing` is the
 * console's answer about the pack as a whole, which the command asks first; nothing is made of
 * one that does not answer a pack, and the command says that as it stands. `url` is the console's
 * origin, where a pack with no deployment of its own is read. With `dataCommand`, the outline of
 * a document names the commands that read its tables and its code blocks, `dataCommand` being
 * the one the pack is read with; without it, the console's addresses stay, as `--json` has them.
 */
export function consolePack(
  reader: PackClient,
  listing: RestSkills,
  options: { readonly url: string; readonly dataCommand?: string | undefined },
): ConsolePack | undefined {
  const { mount } = listing;
  const address = listing.address === null ? undefined : parseAddress(listing.address);
  if (listing.status !== "ready" || mount === null || address === undefined || !address.ok) {
    return undefined;
  }
  let last: PackAnswer | undefined;
  let pages = 0;
  /** One more page of a read the command joins, within what one command follows. */
  const another = (what: string, path: string | undefined): void => {
    pages += 1;
    if (pages > MAX_PAGES) {
      throw new PackError(
        0,
        "invalid_response",
        `The ${what} under ${path ?? "the pack"} are more than the command reads at once (${MAX_PAGES} pages): name a folder or a file under it.`,
      );
    }
  };
  /** The pack's own answer in the console's: a refusal of the one read as the pack's, any other as the console's. */
  const taken = <R>(what: string, answer: PackEnvelope & { readonly read: R | null }): R => {
    last = answer;
    if (answer.status === "ready" && answer.read !== null) {
      return answer.read;
    }
    if (answer.refusal !== null && ofOneRead(answer)) {
      throw new PackError(
        answer.status === "failed" ? 415 : 404,
        answer.refusal.code,
        answer.refusal.message,
        {
          directories: answer.refusal.directories,
          sourceUrl: answer.refusal.sourceUrl ?? undefined,
        },
      );
    }
    throw new PackRefusal(what, answer);
  };
  /** The same, of a read the pack answers with its own standing: ready, or the console says how it stands. */
  const ready = <R extends { readonly status: string }>(
    what: string,
    answer: PackEnvelope & { readonly read: R | null },
  ): Ready<R> => {
    const read = taken(what, answer);
    if (read.status !== "ready") {
      throw new PackRefusal(what, answer);
    }
    return read as Ready<R>;
  };
  return {
    address: address.value,
    source: { kind: "deployment", url: listing.source ?? options.url },
    answered: () => last,
    mount: async () => mount,
    browse: async (query: BrowseQuery): Promise<RestBrowse> => {
      const read = ready("folder", await reader.skillBrowse(query));
      return options.dataCommand === undefined ? read : withDataCommands(read, options.dataCommand);
    },
    find: async (query: FindQuery): Promise<RestFind> =>
      query.query === undefined
        ? listingOf(mount, { cursor: query.cursor, limit: query.limit })
        : ready(
            "search",
            await reader.skillFind(query.query, {
              path: query.path,
              cursor: query.cursor,
              limit: query.limit,
            }),
          ),
    skill: async (path: string, cursor?: string): Promise<RestSkillPage> => {
      pages += 1;
      if (pages > MAX_PAGES) {
        throw new PackError(
          0,
          "invalid_response",
          "The pack answers more pages of a skill than one read takes.",
        );
      }
      return ready("skill", await reader.skill(path, cursor));
    },
    file: async (query: FileQuery): Promise<RestFile> =>
      taken(
        "file",
        await reader.skillFile(query.path, { offset: query.offset, limit: query.limit }),
      ),
    rows: async (query: DataQuery): Promise<RowsPage> => {
      another("tables", query.path);
      return ready("tables", await reader.skillRows(query));
    },
    code: async (query: DataQuery): Promise<CodePage> => {
      another("code blocks", query.path);
      return ready("code blocks", await reader.skillCode(query));
    },
  };
}

/**
 * The listing of a pack as the command prints it. Where the pack answered, `text` is what the
 * skillcdn command prints for it, what a client is told on connect and then every skill, the
 * documents counted, between the lines of the console's own: where the pack is and how it answered,
 * where a person connects an agent of their own, and where the console's own skills are on this
 * machine. Where it did not, why, with that last line still.
 */
export function formatSkills(
  skills: RestSkills,
  text: string | undefined,
  ownSkills?: string,
  owner: PackOwner = "project",
  words: ToolWords = CONSOLE_WORDS,
): string {
  const around = skillsAround(skills, ownSkills, words);
  if (text === undefined || skills.status !== "ready") {
    return [
      refusalWords("skills", skills, owner),
      ...around.own.flatMap((line) => ["", line]),
    ].join("\n");
  }
  return [
    around.head,
    "",
    text,
    ...[...around.host, ...around.own].flatMap((line) => ["", line]),
  ].join("\n");
}

/**
 * The console's own lines around a listing, each where it has one to say: the line above it,
 * where a person connects an agent of their own, and where the console's own skills are on this
 * machine. A listing printed in pages has them above its first page (ADR-0124), so that the
 * page ends with the command that lists the rest.
 */
export function skillsAround(
  skills: RestSkills,
  ownSkills?: string,
  words: ToolWords = CONSOLE_WORDS,
): { readonly head: string; readonly host: readonly string[]; readonly own: readonly string[] } {
  return {
    head: head("skills", skills),
    host:
      skills.page === null
        ? []
        : [
            `A host with a SkillCDN connection of its own loads a skill by its URI, which a person makes at ${skills.page}; through the console, ${words.load} takes the URI too. --json adds the page of each skill, for a person.`,
          ],
    own:
      ownSkills === undefined
        ? []
        : [`The console's own skills, for working the board and keeping a desk: ${ownSkills}`],
  };
}

/**
 * The `SKILL.md` a path names: the path itself where it names one, else the one in the folder
 * it names, since a skill is its folder and a listing cut short shows the folder alone; the
 * root's own for the dot, as the root is everywhere.
 */
function skillFileOf(given: string): string {
  const path = given.replace(/\/+$/, "");
  if (path === "" || path === ".") {
    return "SKILL.md";
  }
  return path === "SKILL.md" || path.endsWith("/SKILL.md") ? path : `${path}/SKILL.md`;
}

/**
 * A skill's path as given, or taken out of the URI the listing names it by
 * (`skill://<host>/<owner>/<name>/<path>`); a URI of another pack would read this pack's skill
 * at the same path, or nothing, so it is said instead.
 */
export function skillPathIn(
  given: string,
  packAddress: string | null,
): { readonly path: string } | { readonly error: string } {
  const uri = parseSkillUri(given);
  if (uri === undefined) {
    return given.startsWith("skill://")
      ? {
          error: `Not a skill's URI the console knows: ${given}. Say the path of its SKILL.md from the repository's root, or the URI console skills lists.`,
        }
      : { path: skillFileOf(given) };
  }
  const pack = packAddress === null ? undefined : parseAddress(packAddress);
  if (
    pack?.ok === true &&
    (uri.address.host !== pack.value.host ||
      uri.address.owner !== pack.value.owner ||
      uri.address.repo !== pack.value.repo)
  ) {
    return {
      error: `That URI is of another pack, /${uri.address.host}/${uri.address.owner}/${uri.address.repo}; this project's pack is at ${packAddress}. Say the path of the SKILL.md, or a URI console skills lists.`,
    };
  }
  return { path: uri.path };
}

/** Whether a read of data held nothing, by what the read says it holds: no table, or no code block. */
export const holdsNothing = (holds: string | undefined): boolean =>
  holds !== undefined && /(^| )0 (tables|code blocks)$/.test(holds);
