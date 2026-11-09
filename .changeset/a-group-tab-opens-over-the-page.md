---
"@skillcdn/console": patch
---

A group tab in the header opens its list of plugins over the page: the list was clipped by the row of tabs, which scrolls sideways, and could be neither seen nor pressed wherever a group held two plugins. The list is a popover in the top layer, placed under its tab with the names lined up under the tab's, dismissed by a click elsewhere or the escape key, its caret turned while it is open; each plugin in it says what it is under its name, from its description (`NavItem.description`), in two lines at most, the one the page is on in the accent. The person's menu lists a group's plugins one by one under the group's name, where it led to the first alone. A tab's name longer than the row has room for stops with an ellipsis, and the tab's title says it whole. The menus are drawn on the raised surface, with a shadow of their own (`--sc-shadow-menu`).
