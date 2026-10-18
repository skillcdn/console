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
  };
}
