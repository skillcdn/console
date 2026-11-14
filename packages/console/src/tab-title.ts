import type { NavItem } from "./components/shell.js";

// What the browser's tab is called: the page shown, the project it is of and the workspace, so
// that two tabs of one console are told apart and a history reads as where one has been.

/** The tab the page is under: the one marked current, or the page of a group that is. */
export function currentTab(nav: readonly NavItem[]): string | undefined {
  const tab = nav.find((item) => item.current);
  if (tab === undefined) {
    return undefined;
  }
  return (tab.children?.find((child) => child.current) ?? tab).label;
}

/** The parts of a title, the nearest first, each said once and nothing for a part that is not there. */
export function tabTitle(parts: readonly (string | undefined)[]): string {
  const said: string[] = [];
  for (const part of parts) {
    const word = part?.trim();
    if (word !== undefined && word !== "" && !said.includes(word)) {
      said.push(word);
    }
  }
  return said.join(" · ");
}
