---
"@skillcdn/console": patch
---

What a plugin could not read at all ([ADR-0063](https://github.com/skillcdn/console/blob/main/docs/adr/0063-a-frame-reads-a-persons-picture-by-the-person-and-a-plugin-reads-who-it-granted-a-role.md)). `frame.people.picture(id)` in `@skillcdn/console/plugin/web` answers an address to put in an image, of a person the plugin may read: a frame loads nothing from elsewhere, so a page could show no faces. `ctx.console.people.granted(role)` answers who was granted a role of the plugin, by name, through a project or with everyone. `frame.context.workspace` says the workspace's `name` and `languages` beside its clock and its week.
