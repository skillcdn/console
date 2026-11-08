// Who may do what with a plugin (docs/specs/plugins.md, "Roles and grants"): a plugin names
// roles; an administrator grants them to a person, to the members of a project, or to everyone;
// `defaultRole` is everyone's without a grant; an administrator holds every role. A command, a
// query, a page or a widget names the roles that may use it, any of them; without roles, every
// member may. Pure: the grants are read by the queries, decided here.

export interface RolesInput {
  /** Whether the person administers the workspace: then every role is theirs. */
  readonly admin: boolean;
  /** The roles the manifest declares. */
  readonly declared: readonly string[];
  /** The role every member holds without a grant, or none. */
  readonly defaultRole: string | undefined;
  /** The roles granted to the person, to the projects they are in, or to everyone, as read. */
  readonly granted: readonly string[];
  /**
   * The roles the person holds by what they are (ADR-0068): a role that follows the reporting
   * line, where someone active reports to them. None when left out.
   */
  readonly followed?: readonly string[] | undefined;
}

/** The roles a person holds in a plugin, among those the manifest declares, in the manifest's order. */
export function rolesHeld(input: RolesInput): string[] {
  if (input.admin) {
    return [...input.declared];
  }
  const held = new Set([...input.granted, ...(input.followed ?? [])]);
  if (input.defaultRole !== undefined) {
    held.add(input.defaultRole);
  }
  return input.declared.filter((role) => held.has(role));
}

/**
 * Whether a person with `held` roles may use what names `required` roles: any of them. `null`
 * names none, and every member may, provided the person is in some role of the plugin, so that a
 * plugin's address and commands are closed to those it is not for; a plugin that declares no
 * roles at all is everyone's.
 */
export function mayUse(
  required: readonly string[] | null,
  held: readonly string[],
  declared: readonly string[],
): boolean {
  if (required !== null) {
    return required.some((role) => held.includes(role));
  }
  return declared.length === 0 || held.length > 0;
}
