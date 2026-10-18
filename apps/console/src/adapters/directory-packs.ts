import { stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type Address,
  browseBody,
  describeLicense,
  directoryBody,
  fileBody,
  findBody,
  type IndexLimits,
  LOCAL_HOST_KEY,
  mountBody,
  REST_MOUNT_LIST_LIMIT,
  type RepoPath,
  type RestFile,
  skillOutcome,
} from "@skillcdn/core";
import { INDEX_LIMIT_DEFAULTS, readDirectory } from "@skillcdn/indexer";
import { createMemoryIndex, type MountContext, Reader, ReaderInputError } from "@skillcdn/reader";
import type { Logger } from "../logger.js";
import type { Clock } from "../ports/clock.js";
import { type Pack, PackError, type PackSource } from "../ports/skill-source.js";

// A pack served from this machine (ADR-0053, ADR-0031): the directory `<owner>/<name>` under the
// one the console was given, for the address `/local/<owner>/<name>`, read as the indexer reads
// a commit, kept as an index in memory for a while, and read with the reader a deployment reads
// with, so that what the console answers from a directory is what a deployment would answer
// from the same commit, and what the skillcdn command answers from the same directory. Whoever
// runs the console chose the directory: the pack is verified, and served in full under its
// license. Nothing in it is executed, and nothing of it is asked of any deployment.

/** How long an index of a directory stands before the directory is read again. */
export const DEFAULT_PACK_CACHE_MS = 60_000;
/** How many directories are held at once: beyond, the oldest index goes. */
const MAX_HELD = 50;

export interface DirectoryPacksOptions {
  /** The directory the packs are under, laid out as `<owner>/<name>`. */
  readonly root: string;
  /** The limits the reading rules apply; the indexer's defaults when left out. */
  readonly limits?: IndexLimits | undefined;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly cacheMs?: number | undefined;
}

/** A mount of a directory: the context the reader needs, and where the files are. */
interface LocalMount extends MountContext {
  readonly root: string;
}

/** A directory read: its reader, and until when the index stands. */
interface Opened {
  readonly reader: Reader<LocalMount>;
  readonly root: string;
  readonly commit: string;
}

/** The answer of a reader whose index is always ready, narrowed to say so. */
function ready<T extends { readonly status: string }>(answer: T): Extract<T, { status: "ready" }> {
  if (answer.status !== "ready") {
    throw new Error("the index of a directory is always ready");
  }
  return answer as Extract<T, { status: "ready" }>;
}

/** What the reader refuses, a path outside the mount or a cursor of another request, as the API says it. */
const asPackError = (error: unknown): never => {
  if (error instanceof ReaderInputError) {
    throw new PackError(400, error.code, error.message);
  }
  throw error;
};

export function createDirectorySource(options: DirectoryPacksOptions): PackSource {
  const root = resolve(options.root);
  const limits = options.limits ?? INDEX_LIMIT_DEFAULTS;
  const cacheMs = options.cacheMs ?? DEFAULT_PACK_CACHE_MS;
  const { clock, logger } = options;
  const held = new Map<string, { readonly loading: Promise<Opened>; readonly until: number }>();

  /** The directory of a pack, read now or held from a little while ago; one read at a time. */
  const opened = (address: Address): Promise<Opened> => {
    const key = `${address.owner}/${address.repo}`;
    const now = clock.now().getTime();
    const kept = held.get(key);
    if (kept !== undefined && kept.until > now) {
      return kept.loading;
    }
    const loading = open(address).catch((error: unknown) => {
      // A directory that could not be read is asked again next time, not in a minute.
      held.delete(key);
      throw error;
    });
    held.delete(key);
    held.set(key, { loading, until: now + cacheMs });
    while (held.size > MAX_HELD) {
      const oldest = held.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      held.delete(oldest);
    }
    return loading;
  };

  const open = async (address: Address): Promise<Opened> => {
    // A working tree is what it is: a ref names nothing (ADR-0053).
    if (address.ref !== undefined) {
      throw new PackError(404, "mount.ref_not_found", "A pack served from a machine has no refs.");
    }
    // The grammar of a local address allows no separator, no leading dot and no `..` as a
    // name, so the directory is under the root; checked once more, since the root is a trust
    // boundary.
    const directory = resolve(join(root, address.owner, address.repo));
    if (!directory.startsWith(`${root}${sep}`)) {
      throw new PackError(404, "mount.repo_not_found", "No such pack is served from this machine.");
    }
    const info = await stat(directory).catch(() => undefined);
    if (info === undefined || !info.isDirectory()) {
      throw new PackError(404, "mount.repo_not_found", "No such pack is served from this machine.");
    }
    let read: Awaited<ReturnType<typeof readDirectory>>;
    try {
      read = await readDirectory({
        directory,
        limits,
        repository: { owner: address.owner, name: address.repo },
      });
    } catch (error) {
      logger.warn(
        { err: error, pack: `${address.owner}/${address.repo}` },
        "a pack could not be read from its directory",
      );
      throw new PackError(0, "network", "The pack could not be read from its directory.");
    }
    logger.debug(
      { pack: `${address.owner}/${address.repo}`, files: read.fileCount, skipped: read.skipped },
      "a pack was read from its directory",
    );
    const index = createMemoryIndex({ index: read.index, blobs: read.blobs });
    const reader = new Reader<LocalMount>({
      limits,
      index: async () => ({ status: "ready", index }),
    });
    return { reader, root: directory, commit: read.commit };
  };

  /** The mount the reader reads: the address, at its path within the pack, over the directory. */
  const mountOf = (address: Address, pack: Opened): LocalMount => {
    const fileUrl = (path: RepoPath): string =>
      pathToFileURL(path.length === 0 ? pack.root : join(pack.root, ...path.split("/"))).href;
    return {
      root: pack.root,
      address,
      commit: pack.commit,
      verified: true,
      limits: {},
      repository: `${address.owner}/${address.repo}`,
      description: undefined,
      sourceUrl: fileUrl,
      rawUrl: fileUrl,
    };
  };

  return {
    open(address) {
      if (address.host !== LOCAL_HOST_KEY) {
        return undefined;
      }
      const pack: Pack = {
        address,
        location: { kind: "directory" },
        async mount() {
          const read = await opened(address);
          const mount = mountOf(address, read);
          return mountBody(
            {
              address,
              repository: {
                host: address.host,
                owner: address.owner,
                name: address.repo,
                defaultBranch: "",
                description: null,
                avatar: "",
                visibility: "public",
              },
              commit: mount.commit,
              verified: mount.verified,
              image: () => null,
            },
            await read.reader.overview(mount, REST_MOUNT_LIST_LIMIT),
          );
        },
        async browse(query) {
          const read = await opened(address);
          const mount = mountOf(address, read);
          return browseBody(ready(await read.reader.browse(mount, query, 0).catch(asPackError)));
        },
        async find(query) {
          const read = await opened(address);
          const mount = mountOf(address, read);
          return findBody(ready(await read.reader.find(mount, query, 0).catch(asPackError)));
        },
        async skill(path, cursor) {
          const read = await opened(address);
          const mount = mountOf(address, read);
          const outcome = skillOutcome(
            ready(await read.reader.skill(mount, path, 0, cursor, true).catch(asPackError)),
          );
          if ("failure" in outcome) {
            const { status, code, message, directories } = outcome.failure;
            throw new PackError(status, code, message, { directories });
          }
          return outcome.body;
        },
        async file(query): Promise<RestFile> {
          const read = await opened(address);
          const mount = mountOf(address, read);
          const lookup = await read.reader.file(mount, query).catch(asPackError);
          switch (lookup.kind) {
            case "not_ready":
              throw new Error("the index of a directory is always ready");
            case "found":
              return fileBody(lookup.file);
            case "directory":
              return directoryBody(lookup.directory);
            case "invalid_path":
              throw new PackError(400, "request.invalid", `Not a valid path: ${lookup.reason}.`);
            case "not_found":
              throw new PackError(
                404,
                "file.not_found",
                `No file at that path in this pack.${lookup.suggestions?.length ? ` Candidates: ${lookup.suggestions.join(", ")}.` : ""}`,
              );
            case "too_large":
              throw new PackError(
                413,
                "file.too_large",
                `The file is too large to read here (${lookup.size} bytes; the limit is ${lookup.limit}). Read it at its source: ${lookup.sourceUrl}`,
                { sourceUrl: lookup.sourceUrl },
              );
            case "not_text":
              throw new PackError(
                415,
                "file.not_text",
                `The file is not UTF-8 text, which is all a read carries. Read it at its source: ${lookup.sourceUrl}`,
                { sourceUrl: lookup.sourceUrl },
              );
            case "not_served":
              throw new PackError(
                403,
                "file.not_served",
                `The file is described, not served: its license (${describeLicense(lookup.license)}) allows SkillCDN to say that it exists, not to pass its content on. Read it at its source: ${lookup.sourceUrl}`,
                { sourceUrl: lookup.sourceUrl },
              );
          }
        },
      };
      return pack;
    },
  };
}
