import type { RestWorkspace } from "@skillcdn/console/api";
import type { WorkspaceRecord, WorkspaceSettings } from "../db/queries/workspaces.js";

/**
 * The workspace as the API answers it: in `me`, and from every route that changes one of its
 * settings or its SkillCDN token, so that the pages hold the same shape wherever it comes from.
 */
export function restWorkspace(
  found: WorkspaceRecord,
  settings: WorkspaceSettings,
  skills: { readonly source: string; readonly address: string | undefined },
  tokenDaysAtMost: number | undefined,
): RestWorkspace {
  return {
    name: found.name,
    handle: settings.handle,
    domain: settings.domain,
    services: { ...settings.services },
    tokenDaysAtMost: tokenDaysAtMost ?? null,
    skills: {
      source: skills.source,
      address: skills.address ?? null,
      packToken:
        settings.packTokenSetAt === null ? null : { setAt: settings.packTokenSetAt.toISOString() },
    },
    peopleVisibility: settings.peopleVisibility,
    weekStart: settings.weekStart,
    timeZone: settings.timeZone,
    language: settings.language,
  };
}

/**
 * The workspace as nobody signed in is told of it: without its short name, its domain and the
 * services its agents work with (ADR-0089), which say what its accounts are named and where they
 * are kept, and are its members' to read. The sign-in page needs the name, the language and the
 * ways in; each of the three is read as optional.
 */
export function restWorkspaceForNobody(workspace: RestWorkspace): RestWorkspace {
  const { handle, domain, services, ...open } = workspace;
  return open;
}
