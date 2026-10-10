import { MAX_DOCUMENT_PATH_LENGTH, MAX_DOCUMENT_SEGMENT_LENGTH } from "./limits.js";

// A document's address (ADR-0009): a path of lowercase segments, as a repository keeps files,
// and the way a link in Markdown names one. The server records the links a text makes with
// these, and the pages turn them into links to the document's page; both read the same rule.

/** One segment of a path: lowercase letters, digits and hyphens, beginning and ending with a letter or a digit. */
const SEGMENT = "[a-z0-9](?:[a-z0-9-]*[a-z0-9])?";

/** A document's path: segments separated by `/`, with no slash at either end. */
export const DOCUMENT_PATH = new RegExp(`^${SEGMENT}(?:/${SEGMENT})*$`);

/** True when `value` is a document's path, within the bounds. */
export function isDocumentPath(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_DOCUMENT_PATH_LENGTH &&
    DOCUMENT_PATH.test(value) &&
    value.split("/").every((segment) => segment.length <= MAX_DOCUMENT_SEGMENT_LENGTH)
  );
}

/** True when `value` names a folder: the root (`""`), or a path by the same rule. */
export function isFolderPath(value: string): boolean {
  return value === "" || isDocumentPath(value);
}

/** The folder a path is in: `guides` for `guides/onboarding`, `""` for a page at the root. */
export function folderOf(path: string): string {
  const at = path.lastIndexOf("/");
  return at < 0 ? "" : path.slice(0, at);
}

/** The last segment of a path: what the page is called in its folder. */
export function nameOf(path: string): string {
  const at = path.lastIndexOf("/");
  return at < 0 ? path : path.slice(at + 1);
}

/** The folders above a path, from the root down: `["guides", "guides/setup"]` for `guides/setup/git`. */
export function foldersAbove(path: string): string[] {
  const segments = path.split("/").slice(0, -1);
  return segments.map((_, index) => segments.slice(0, index + 1).join("/"));
}

/**
 * The destination of a link in Markdown: `[words](destination "title")`, and a reference
 * definition, `[label]: destination`. A picture (`![alt](source)`) is not a link to a page.
 */
const INLINE_LINK =
  /(!?)\[[^\]]*\]\(\s*<?([^\s()<>]+)>?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
const REFERENCE_DEFINITION = /^[ \t]{0,3}\[[^\]]+\]:[ \t]*<?([^\s<>]+)>?/gm;

/**
 * The documents a Markdown text links to, by path, each once and in order: every link whose
 * destination is a document path, read from the project's root wherever the text is. A
 * fragment (`#heading`) names a place in the page and is left off. Linear in the text.
 */
export function documentPathsIn(markdown: string): string[] {
  const found = new Set<string>();
  const consider = (destination: string | undefined) => {
    const path = (destination ?? "").split("#", 1)[0] ?? "";
    if (isDocumentPath(path)) {
      found.add(path);
    }
  };
  for (const match of markdown.matchAll(INLINE_LINK)) {
    if (match[1] !== "!") {
      consider(match[2]);
    }
  }
  for (const match of markdown.matchAll(REFERENCE_DEFINITION)) {
    consider(match[1]);
  }
  return [...found].sort();
}
