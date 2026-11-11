/**
 * The roles of the one image, selected by the container command (ADR-0002): the three a
 * deployment runs, and `verify`, which whoever keeps the database runs by hand to check the
 * transcript against its chains (ADR-0090).
 */
export const ROLES = ["api", "worker", "migrate", "verify"] as const;

export type Role = (typeof ROLES)[number];

export type RoleSelection =
  | { readonly ok: true; readonly role: Role; readonly args: readonly string[] }
  | { readonly ok: false; readonly reason: "missing" | "unknown" };

const isRole = (value: string): value is Role => (ROLES as readonly string[]).includes(value);

/** The role the command line asks for: its first argument, with the words after it, which are the role's own to read. */
export function selectRole(args: readonly string[]): RoleSelection {
  const [first, ...rest] = args;
  if (first === undefined) {
    return { ok: false, reason: "missing" };
  }
  return isRole(first) ? { ok: true, role: first, args: rest } : { ok: false, reason: "unknown" };
}
