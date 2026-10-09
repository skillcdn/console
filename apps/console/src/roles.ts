/** The roles of the one image, selected by the container command (ADR-0002). */
export const ROLES = ["api", "worker", "migrate"] as const;

export type Role = (typeof ROLES)[number];

export type RoleSelection =
  | { readonly ok: true; readonly role: Role }
  | { readonly ok: false; readonly reason: "missing" | "unknown" };

const isRole = (value: string): value is Role => (ROLES as readonly string[]).includes(value);

/** The role the command line asks for: its first argument, and nothing else is read. */
export function selectRole(args: readonly string[]): RoleSelection {
  const [first] = args;
  if (first === undefined) {
    return { ok: false, reason: "missing" };
  }
  return isRole(first) ? { ok: true, role: first } : { ok: false, reason: "unknown" };
}
