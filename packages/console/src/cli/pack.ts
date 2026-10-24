import {
  type BrowseResult,
  browseBody,
  browseResultOf,
  catalogStateOf,
  type DirectoryResult,
  directoryBody,
  directoryResultOf,
  type FileResult,
  type FindItem,
  type FindResult,
  fileBody,
  fileResultOf,
  findResultOf,
  joinSkillPages,
  type MountSummary,
  mountSummaryOf,
  parseAddress,
  parseRepoPath,
  parseSkillUri,
  type RestBrowse,
  type RestFile,
  type RestMount,
  type RestSkill,
  renderBrowseResult,
  renderDirectoryResult,
  renderFileResult,
  renderFindResult,
  renderInstructions,
  renderSkillResult,
  type SkillResult,
  skillOutcome,
  skillResultOf,
  type ToolWords,
} from "@skillcdn/core";
import type {
  RestSkillBrowse,
  RestSkillFile,
  RestSkillFind,
  RestSkillLoad,
  RestSkills,
} from "../schemas.js";
import type { SkillsStatus } from "../vocabulary.js";

// The pack of the project, as the command prints it (ADR-0028, ADR-0031): the console answers
// what the pack's REST API answered, in the shapes of @skillcdn/core, and the command renders
// it with the functions a deployment's own tools render for a model, naming the reads as its
// own commands, so that an agent reads here what it would read over MCP, or with the skillcdn
// command. The pages a read came in are joined first: a skill, a folder and a file arrive whole.

/** How the results name the four reads, so that an agent is told the command and not a tool. */
export const CONSOLE_WORDS: ToolWords = {
  browse: "console skills <folder>",
  search: "console skills --search",
  load: "console skill",
  read: "console skill --file",
};

/** Where the reads of a pack are rendered at: what the listing said the address serves. */
export type PackSummary = MountSummary;

export const NO_ADDRESS = "No skills address: neither this project nor the console names one.";

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

type Envelope = Pick<RestSkills, "address" | "source" | "page" | "status" | "refusal">;

/** The first line of an answer about the pack: what was read, where the pack is, and how it went. */
function head(what: string, answer: Envelope): string {
  const where =
    answer.source === null ? "read from the console's machine" : `served by ${answer.source}`;
  return `${what} at ${answer.address}, ${where}: ${answer.status}`;
}

/** A read that did not happen: the head, the words of its status, and the pack's own refusal when it gave one. */
function refused(what: string, answer: Envelope): string {
  const lines = [head(what, answer)];
  if (answer.status !== "none" && answer.status !== "ready") {
    lines.push(SKILLS_WORDS[answer.status]);
  }
  if (answer.refusal !== null) {
    lines.push(answer.refusal.message);
  }
  return lines.join("\n");
}

/** What the listing said the address serves, for the reads to be rendered at; nothing when it did not answer. */
export function summaryOf(listing: RestSkills): PackSummary | undefined {
  return listing.mount === null ? undefined : mountSummaryOf(listing.mount);
}

/** Every skill and document the address serves, as one listing: what `search_repo` without words answers. */
function listingOf(mount: RestMount, summary: PackSummary): FindResult | undefined {
  if (mount.index.status !== "ready") {
    return undefined;
  }
  const { index } = mount;
  const items: FindItem[] = [];
  for (const skill of index.skills) {
    const directory = parseRepoPath(skill.directory);
    if (!directory.ok) {
      continue;
    }
    const path = parseRepoPath(
      skill.path ?? (skill.directory === "" ? "SKILL.md" : `${skill.directory}/SKILL.md`),
    );
    items.push({
      kind: "skill",
      ...(path.ok ? { path: path.value } : {}),
      name: skill.name,
      directory: directory.value,
      description: skill.description,
      files: [],
      moreFiles: 0,
      // For people, and not rendered for a model.
      translations: {},
    });
  }
  for (const document of index.documents) {
    const path = parseRepoPath(document.path);
    if (path.ok) {
      items.push({
        kind: "document",
        path: path.value,
        title: document.title ?? undefined,
        summary: document.summary ?? undefined,
        skillDirectory: undefined,
      });
    }
  }
  const state = catalogStateOf(mount);
  return {
    mount: summary,
    query: undefined,
    items,
    // The counts stand in the instructions above; without totals here, nothing suggests a cursor.
    totals: undefined,
    diagnostics: state.status === "ready" ? state.catalog.diagnostics : [],
  };
}

/**
 * The pack: where it is and how it answered; what a client is told on connect, as the
 * deployment tells one; every skill and document; where a person connects an agent of its own;
 * and where the console's own skills are on this machine.
 */
export function formatSkills(skills: RestSkills, ownSkills?: string): string {
  const own =
    ownSkills === undefined
      ? []
      : ["", `The console's own skills, for working the board: ${ownSkills}`];
  if (skills.status === "none" || skills.address === null) {
    return [NO_ADDRESS, ...own].join("\n");
  }
  const summary = summaryOf(skills);
  if (skills.status !== "ready" || skills.mount === null || summary === undefined) {
    return [refused("skills", skills), ...own].join("\n");
  }
  const lines = [
    head("skills", skills),
    "",
    renderInstructions(catalogStateOf(skills.mount), CONSOLE_WORDS),
  ];
  const listing = listingOf(skills.mount, summary);
  if (listing !== undefined) {
    lines.push("", renderFindResult(listing, CONSOLE_WORDS));
  }
  if (skills.page !== null) {
    lines.push(
      "",
      `A host with a SkillCDN connection of its own loads a skill by its URI, which a person makes at ${skills.page}; through the console, ${CONSOLE_WORDS.load} takes the URI too. --json adds the page of each skill, for a person.`,
    );
  }
  lines.push(...own);
  return lines.join("\n");
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
      : { path: given };
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

/** The pages of a skill, as the console answered them, as the one skill they were cut from. */
export function joinSkill(
  pages: readonly RestSkillLoad[],
  summary: PackSummary,
): SkillResult | undefined {
  return joinSkillPages(
    pages.flatMap((page) =>
      page.read?.status === "ready" ? (skillResultOf(page.read, summary) ?? []) : [],
    ),
  );
}

/** The skill whole, as the REST API answers one, for `--json`. */
export function bodyOfSkill(skill: SkillResult): RestSkill {
  const outcome = skillOutcome({ status: "ready", lookup: { kind: "found", skill } });
  if ("failure" in outcome) {
    throw new Error("a skill that was found has a body");
  }
  return outcome.body;
}

/** One skill as `load_skill` lays it out for a model: the rules, the body, the included files, its files and references. */
export function formatSkillLoad(loaded: RestSkillLoad, whole: SkillResult | undefined): string {
  if (loaded.status === "none" || loaded.address === null) {
    return NO_ADDRESS;
  }
  if (loaded.status !== "ready") {
    return refused("skill", loaded);
  }
  if (whole === undefined) {
    return `${head("skill", loaded)}\nNothing was read.`;
  }
  return renderSkillResult(whole, CONSOLE_WORDS);
}

/** The pages of a folder, as the console answered them, as the one listing they were cut from. */
export function joinFolder(
  pages: readonly RestSkillBrowse[],
  summary: PackSummary,
): BrowseResult | undefined {
  const results = pages.flatMap((page) =>
    page.read?.status === "ready" ? (browseResultOf(page.read, summary) ?? []) : [],
  );
  const first = results[0];
  const last = results[results.length - 1];
  if (first === undefined || last === undefined) {
    return undefined;
  }
  // A file's path answers its outline (SkillCDN 0.4), its headings paged as a folder's entries are.
  const outline =
    first.outline === undefined
      ? undefined
      : {
          ...first.outline,
          headings: results.flatMap((result) => result.outline?.headings ?? []),
        };
  return {
    ...first,
    mount: last.mount,
    entries: results.flatMap((result) => result.entries),
    nextCursor: last.nextCursor,
    ...(outline === undefined ? {} : { outline }),
  };
}

/** A folder whole, as the REST API answers one page, for `--json`. */
export const bodyOfFolder = (result: BrowseResult): RestBrowse =>
  browseBody({ status: "ready", result });

/** What a folder holds, as `browse_repo` lays it out for a model. */
export function formatSkillBrowse(
  browsed: RestSkillBrowse,
  whole: BrowseResult | undefined,
): string {
  if (browsed.status === "none" || browsed.address === null) {
    return NO_ADDRESS;
  }
  if (browsed.status !== "ready") {
    return refused("folder", browsed);
  }
  if (whole === undefined) {
    return `${head("folder", browsed)}\nNothing was read.`;
  }
  return renderBrowseResult(whole, CONSOLE_WORDS);
}

/** What words found, as `search_repo` lays it out for a model, one page of it. */
export function formatSkillFind(found: RestSkillFind, summary: PackSummary | undefined): string {
  if (found.status === "none" || found.address === null) {
    return NO_ADDRESS;
  }
  if (found.status !== "ready" || found.read?.status !== "ready" || summary === undefined) {
    return refused("search", found);
  }
  return renderFindResult(findResultOf(found.read, summary), CONSOLE_WORDS);
}

/**
 * The pages of a file, as the console answered them, as the file whole; or the folder the path
 * named. With `requested`, the one page is a section read as asked (`--offset`, `--limit`): the
 * result carries the length asked for, so that the renderer says where the file continues rather
 * than asking for the rest.
 */
export function joinFile(
  pages: readonly RestSkillFile[],
  summary: PackSummary,
  requested?: number,
): FileResult | DirectoryResult | undefined {
  const reads = pages.flatMap((page) => (page.read === null ? [] : [page.read]));
  const first = reads[0];
  if (first === undefined) {
    return undefined;
  }
  if (first.kind === "directory") {
    return directoryResultOf(first, summary);
  }
  const files = reads.flatMap((read) =>
    read.kind === "file" ? (fileResultOf(read, summary) ?? []) : [],
  );
  const opening = files[0];
  const closing = files[files.length - 1];
  if (opening === undefined || closing === undefined) {
    return undefined;
  }
  return {
    ...opening,
    mount: closing.mount,
    content: files.map((file) => file.content).join(""),
    nextOffset: closing.nextOffset,
    totalLength: closing.totalLength,
    ...(requested === undefined ? {} : { requestedLength: requested }),
  };
}

/** A file whole, or a folder, as the REST API answers it, for `--json`. */
export const bodyOfFile = (result: FileResult | DirectoryResult): RestFile =>
  "entries" in result ? directoryBody(result) : fileBody(result);

/** A file as `read_repo_file` lays it out for a model, whole; or what the folder holds. */
export function formatSkillFile(
  read: RestSkillFile,
  whole: FileResult | DirectoryResult | undefined,
): string {
  if (read.status === "none" || read.address === null) {
    return NO_ADDRESS;
  }
  if (read.status !== "ready") {
    return refused("file", read);
  }
  if (whole === undefined) {
    return `${head("file", read)}\nNothing was read.`;
  }
  return "entries" in whole ? renderDirectoryResult(whole) : renderFileResult(whole, CONSOLE_WORDS);
}
