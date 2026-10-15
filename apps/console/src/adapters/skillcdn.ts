import {
  restBrowseSchema,
  restFileSchema,
  restFindSchema,
  restMountSchema,
  restPath,
  restSkillSchema,
} from "@skillcdn/core";
import type { Logger } from "../logger.js";
import type {
  SkillListing,
  SkillPage,
  SkillSource,
  SkillSourceStatus,
} from "../ports/skill-source.js";
import { DEFAULT_TIMEOUT_MS, type FetchLike, readBody } from "./upstream.js";

// The SkillCDN deployment's side of the skill source: the mount overview of an address, one
// skill as `load_skill` answers it, a file as `read_repo_file` does, a folder as `browse_repo`
// and a search as `search_repo`, each one read of the deployment's REST API, parsed with the
// contracts of @skillcdn/core. A pack token a project
// holds (ADR-0028) travels as the bearer of the request and nowhere else; a redirect is not
// followed. The deployment is someone else's: what it answers is bounded and checked, and what
// goes wrong is a status, so that the board stays up when the skills are not there.

/** A mount overview lists at most a couple of hundred skills and documents; this is far above. */
const MAX_OVERVIEW_BYTES = 1024 * 1024;
/** A page of a skill is 16 KiB of text and its metadata, a page of a file up to 100,000 characters; this is far above both. */
const MAX_PAGE_BYTES = 2 * 1024 * 1024;

export interface SkillCdnOptions {
  /** The origin of the deployment, such as `https://skillcdn.ai`. */
  readonly baseUrl: string;
  readonly userAgent: string;
  readonly logger: Logger;
  /** The platform's `fetch` when left out. Tests hand in one that never leaves the process. */
  readonly fetch?: FetchLike | undefined;
  readonly timeoutMs?: number | undefined;
}

type Failed = Exclude<SkillSourceStatus, "ready">;
type Fetched =
  | { readonly kind: "json"; readonly json: unknown }
  | { readonly kind: "status"; readonly status: Failed };

const nothing = (status: Failed): SkillListing => ({ status, skills: [] });

/** The code of an error answer, when the body is one; nothing for anything else. */
async function errorCodeOf(response: Response): Promise<string | undefined> {
  try {
    const bytes = await readBody(response, 4096);
    if (bytes === undefined) {
      return undefined;
    }
    const json: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (typeof json !== "object" || json === null || !("error" in json)) {
      return undefined;
    }
    const { error } = json;
    return typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
      ? error.code
      : undefined;
  } catch {
    return undefined;
  }
}

/** A query string of what is given, in the order given. */
function queryOf(entries: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(entries)) {
    if (value !== undefined) {
      query.set(name, String(value));
    }
  }
  const text = query.toString();
  return text === "" ? "" : `?${text}`;
}

/** The first of the texts that says something; nothing when none does. */
function firstOf(...texts: readonly (string | null | undefined)[]): string | undefined {
  return texts.find((text): text is string => typeof text === "string" && text.trim() !== "");
}

/** The path of a skill's `SKILL.md`, from its directory where the deployment left the path out. */
const skillPathOf = (path: string | undefined, directory: string): string =>
  path ?? (directory === "" ? "SKILL.md" : `${directory}/SKILL.md`);

export function createSkillCdnSource(options: SkillCdnOptions): SkillSource {
  const { logger } = options;
  const send = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  /** One read of the deployment: the JSON it answered, or why there is none to read. */
  const fetchJson = async (
    url: string,
    token: string | undefined,
    maxBytes: number,
  ): Promise<Fetched> => {
    let response: Response;
    try {
      response = await send(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          "user-agent": options.userAgent,
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        },
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      logger.warn({ err: error }, "the SkillCDN deployment could not be reached");
      return { kind: "status", status: "unavailable" };
    }
    // The pack token is no good there: expired, revoked, or made for another repository.
    if (response.status === 401) {
      await response.body?.cancel();
      return { kind: "status", status: "token_invalid" };
    }
    // Not served, or not to someone the deployment does not know: the same to the board.
    if (response.status === 404 || response.status === 403) {
      await response.body?.cancel();
      return { kind: "status", status: "not_found" };
    }
    // A file is read only once the index is known, and the deployment says so by its code; any
    // other 503 is the deployment itself, or the git host behind it, out of reach.
    if (response.status === 503) {
      const code = await errorCodeOf(response);
      return {
        kind: "status",
        status:
          code === "index.indexing"
            ? "indexing"
            : code === "index.failed"
              ? "failed"
              : "unavailable",
      };
    }
    // A file too large to carry, or not text: the deployment refuses it as it refuses what it cannot index.
    if (response.status === 413 || response.status === 415) {
      await response.body?.cancel();
      return { kind: "status", status: "failed" };
    }
    if (!response.ok) {
      await response.body?.cancel();
      logger.warn({ status: response.status }, "the SkillCDN deployment answered an error");
      return { kind: "status", status: "unavailable" };
    }
    // The body comes under the same timeout as the headers: a deployment that stops answering
    // half-way is one that could not be reached.
    let bytes: Uint8Array | undefined;
    try {
      bytes = await readBody(response, maxBytes);
    } catch (error) {
      logger.warn({ err: error }, "the SkillCDN deployment stopped answering");
      return { kind: "status", status: "unavailable" };
    }
    if (bytes === undefined) {
      logger.warn("the SkillCDN deployment answered more than is read");
      return { kind: "status", status: "unavailable" };
    }
    try {
      return {
        kind: "json",
        json: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      };
    } catch {
      logger.warn("the SkillCDN deployment answered something that is not JSON");
      return { kind: "status", status: "unavailable" };
    }
  };

  return {
    async list(address, token) {
      const fetched = await fetchJson(
        `${options.baseUrl}${restPath("mounts", address)}`,
        token,
        MAX_OVERVIEW_BYTES,
      );
      if (fetched.kind === "status") {
        return nothing(fetched.status);
      }
      const parsed = restMountSchema.safeParse(fetched.json);
      if (!parsed.success) {
        logger.warn("the SkillCDN deployment answered an overview in an unexpected shape");
        return nothing("unavailable");
      }
      const { index, repository } = parsed.data;
      if (index.status !== "ready") {
        return nothing(index.status);
      }
      // The pack by name, as the deployment's own instructions name it to a model: the
      // manifest's, else its README's, else the host's.
      const manifest = index.manifest ?? undefined;
      return {
        status: "ready",
        pack: {
          name: firstOf(manifest?.name, index.overview?.title, repository.name),
          description: firstOf(
            manifest?.description,
            index.overview?.description,
            repository.description,
          ),
          language: firstOf(manifest?.language),
        },
        counts: { skills: index.skillCount, documents: index.documentCount },
        skills: index.skills.map((skill) => ({
          name: skill.name,
          description: skill.description,
          directory: skill.directory,
          path: skillPathOf(skill.path, skill.directory),
          translations: skill.translations,
        })),
      };
    },

    async load(address, path, cursor, token) {
      const fetched = await fetchJson(
        `${options.baseUrl}${restPath("skills", address)}${queryOf({ path, cursor })}`,
        token,
        MAX_PAGE_BYTES,
      );
      if (fetched.kind === "status") {
        return { status: fetched.status };
      }
      const parsed = restSkillSchema.safeParse(fetched.json);
      if (!parsed.success) {
        logger.warn("the SkillCDN deployment answered a skill in an unexpected shape");
        return { status: "unavailable" };
      }
      if (parsed.data.status !== "ready") {
        return { status: parsed.data.status };
      }
      const { skill } = parsed.data;
      const rules = skill.ruleChain ?? (skill.rules === null ? [] : [skill.rules]);
      const page: SkillPage = {
        path: skill.path ?? path,
        directory: skill.directory,
        name: skill.name,
        description: skill.description,
        rules: rules.map((rule) => ({
          path: rule.path ?? "SKILLCDN.md",
          body: rule.body,
          truncated: rule.truncated,
        })),
        body: skill.body,
        included: (skill.includedContents ?? []).map((file) => ({
          path: file.path,
          body: file.content ?? "",
          truncated: file.truncated,
        })),
        files: skill.files,
        references: (skill.references ?? []).map((reference) => ({
          path: reference.path,
          status: reference.status,
        })),
        complete: skill.complete ?? true,
        nextCursor: skill.nextCursor ?? undefined,
        serving: {
          full: skill.serving?.full ?? true,
          license: skill.serving?.license.name ?? skill.license ?? undefined,
          sourceUrl: skill.serving?.sourceUrl,
        },
        warnings: skill.warnings,
      };
      return { status: "ready", skill: page };
    },

    async browse(address, page, token) {
      const fetched = await fetchJson(
        `${options.baseUrl}${restPath("browse", address)}${queryOf({ path: page.path, cursor: page.cursor, limit: page.limit })}`,
        token,
        MAX_PAGE_BYTES,
      );
      if (fetched.kind === "status") {
        return { status: fetched.status };
      }
      const parsed = restBrowseSchema.safeParse(fetched.json);
      if (!parsed.success) {
        logger.warn("the SkillCDN deployment answered a folder in an unexpected shape");
        return { status: "unavailable" };
      }
      if (parsed.data.status !== "ready") {
        return { status: parsed.data.status };
      }
      const { data } = parsed;
      return {
        status: "ready",
        folder: {
          path: data.path,
          overview:
            data.overview === undefined
              ? undefined
              : {
                  path: data.overview.path,
                  title: data.overview.title ?? undefined,
                  description: data.overview.description ?? undefined,
                },
          entries: data.entries.map((entry) => ({
            kind: entry.kind,
            path: entry.path,
            name: entry.name ?? undefined,
            description: entry.description ?? undefined,
            skillCount: entry.skillCount,
            documentCount: entry.documentCount,
            size: entry.size ?? undefined,
            overviewPath: entry.overviewPath,
            license: entry.license?.name ?? undefined,
            describedOnly: entry.describedOnly ?? false,
          })),
          nextCursor: data.nextCursor ?? undefined,
        },
      };
    },

    async find(address, query, token) {
      const fetched = await fetchJson(
        `${options.baseUrl}${restPath("find", address)}${queryOf({ query: query.query, path: query.path, cursor: query.cursor, limit: query.limit })}`,
        token,
        MAX_PAGE_BYTES,
      );
      if (fetched.kind === "status") {
        return { status: fetched.status };
      }
      const parsed = restFindSchema.safeParse(fetched.json);
      if (!parsed.success) {
        logger.warn("the SkillCDN deployment answered a search in an unexpected shape");
        return { status: "unavailable" };
      }
      if (parsed.data.status !== "ready") {
        return { status: parsed.data.status };
      }
      const { data } = parsed;
      return {
        status: "ready",
        found: {
          query: data.query ?? query.query,
          path: data.path ?? query.path,
          items: data.items.map((item) =>
            item.kind === "skill"
              ? {
                  kind: "skill",
                  path: skillPathOf(item.path, item.directory),
                  directory: item.directory,
                  name: item.name,
                  description: item.description,
                  translations: item.translations,
                  files: item.files.map((file) => ({
                    path: file.path,
                    title: file.title ?? undefined,
                    summary: file.summary ?? undefined,
                  })),
                  moreFiles: item.moreFiles,
                  license: item.license?.name ?? undefined,
                  describedOnly: item.describedOnly ?? false,
                }
              : {
                  kind: "document",
                  path: item.path,
                  title: item.title ?? undefined,
                  summary: item.summary ?? undefined,
                  skillDirectory: item.skillDirectory ?? undefined,
                },
          ),
          nextCursor: data.nextCursor ?? undefined,
        },
      };
    },

    async read(address, path, page, token) {
      const fetched = await fetchJson(
        `${options.baseUrl}${restPath("files", address)}${queryOf({ path, offset: page.offset, limit: page.limit })}`,
        token,
        MAX_PAGE_BYTES,
      );
      if (fetched.kind === "status") {
        return { status: fetched.status };
      }
      const parsed = restFileSchema.safeParse(fetched.json);
      if (!parsed.success) {
        logger.warn("the SkillCDN deployment answered a file in an unexpected shape");
        return { status: "unavailable" };
      }
      if (parsed.data.kind === "directory") {
        return {
          status: "ready",
          file: undefined,
          folder: {
            path: parsed.data.path,
            entries: parsed.data.entries.map((entry) => ({
              path: entry.path,
              kind: entry.kind,
              size: entry.size ?? undefined,
            })),
            truncated: parsed.data.truncated,
          },
        };
      }
      return {
        status: "ready",
        file: {
          path: parsed.data.path,
          content: parsed.data.content,
          offset: parsed.data.offset,
          nextOffset: parsed.data.nextOffset ?? undefined,
          totalLength: parsed.data.totalLength,
        },
        folder: undefined,
      };
    },
  };
}
