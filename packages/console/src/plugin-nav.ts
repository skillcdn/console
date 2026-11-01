import type { NavItem } from "./components/shell.js";
import type { Messages } from "./i18n/en.js";
import { pluginHref } from "./router.js";
import type { RestPlugin, RestRulesPlugin } from "./schemas.js";

// The tabs of the plugins (ADR-0054, docs/specs/plugins.md, "Tabs, sub-tabs and addresses"):
// after the console's own tabs, the groups that hold a plugin the person has a role in. A group
// with one plugin is a tab with the plugin's name; one with several is a tab with the group's
// name that opens the list of them. Groups and plugins are ordered by `menu.order`, then by key.
// Pure: what the tabs are, from what the console was told, for the composition and its tests.

/** A text in the person's language, else in English, else the first the manifest has. */
export function pluginWordOf(
  texts: Readonly<Record<string, string>> | null | undefined,
  language: string,
): string {
  if (texts === null || texts === undefined) {
    return "";
  }
  return (
    texts[language] ??
    texts[language.split("-")[0] ?? language] ??
    texts.en ??
    Object.values(texts)[0] ??
    ""
  );
}

/** The pages of a plugin at a level, in the manifest's order: what the person may see of them. */
export function pluginPagesAt(
  plugin: RestPlugin,
  level: "workspace" | "project",
): RestPlugin["pages"] {
  return plugin.pages.filter((page) => page.level === level);
}

/** Where a plugin's tab leads: its first page at the level. */
function firstPageHref(
  plugin: RestPlugin,
  level: "workspace" | "project",
  project: string | undefined,
): string | undefined {
  const [first] = pluginPagesAt(plugin, level);
  return first === undefined ? undefined : pluginHref(plugin.key, first.key, project);
}

/** What the current address names, for the tabs to say which is current. */
export interface PluginRouteFacts {
  readonly plugin: string | undefined;
}

/**
 * The tabs of the plugins at a level: on the workspace, every enabled plugin with a page there the
 * person may see; on a project, those bound to it (as the project's rules name them) with a
 * project page. Grouped by `menu.group`, named in the person's language.
 */
export function pluginNavItems(input: {
  readonly plugins: readonly RestPlugin[];
  readonly level: "workspace" | "project";
  /** The project the tabs are on, with the plugins bound to it; nothing on the workspace. */
  readonly project?:
    | { readonly key: string; readonly plugins: readonly RestRulesPlugin[] }
    | undefined;
  readonly current: PluginRouteFacts;
  readonly words: Messages;
  readonly language: string;
}): NavItem[] {
  const { plugins, level, project, current, words, language } = input;
  const bound = project === undefined ? undefined : new Set(project.plugins.map((p) => p.key));
  const shown = plugins
    .filter((plugin) => plugin.state === "enabled")
    .filter((plugin) => bound === undefined || bound.has(plugin.key))
    .filter((plugin) => pluginPagesAt(plugin, level).length > 0);
  const groups = new Map<string, { order: number; name: string; plugins: RestPlugin[] }>();
  for (const plugin of shown) {
    const group = plugin.menu?.group ?? "operations";
    const known = words.nav.pluginGroups[group];
    const name =
      known ??
      (plugin.menu?.name === null || plugin.menu?.name === undefined
        ? group
        : pluginWordOf(plugin.menu.name, language));
    const order = plugin.menu?.order ?? 100;
    const held = groups.get(group);
    if (held === undefined) {
      groups.set(group, { order, name, plugins: [plugin] });
    } else {
      held.plugins.push(plugin);
      held.order = Math.min(held.order, order);
    }
  }
  const byOrder = (a: { order: number; key: string }, b: { order: number; key: string }) =>
    a.order - b.order || a.key.localeCompare(b.key);
  return [...groups.entries()]
    .map(([key, group]) => ({ key, ...group }))
    .sort(byOrder)
    .flatMap((group) => {
      const members = [...group.plugins].sort((a, b) =>
        byOrder(
          { order: a.menu?.order ?? 100, key: a.key },
          { order: b.menu?.order ?? 100, key: b.key },
        ),
      );
      const items = members.flatMap((plugin): NavItem[] => {
        const href = firstPageHref(plugin, level, project?.key);
        return href === undefined
          ? []
          : [
              {
                href,
                label: pluginWordOf(plugin.name, language),
                current: current.plugin === plugin.key,
              },
            ];
      });
      if (items.length === 0) {
        return [];
      }
      if (items.length === 1) {
        return items;
      }
      const first = items[0] as NavItem;
      return [
        {
          href: first.href,
          label: group.name,
          current: items.some((item) => item.current),
          children: items,
        },
      ];
    });
}
