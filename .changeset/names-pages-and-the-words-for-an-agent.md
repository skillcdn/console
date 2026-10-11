---
"@skillcdn/console": patch
---

People by name, pages of a console's own, and the words a person tells their agent.

- **The default UI.** A person is shown by the name their host gives, with the login on hover, and by the login where there is no name: `PersonChip`, `Avatar`'s initial, the header's menu, the pickers of a person, the runs' labels and who-has-what; `personName` (from the components) is the rule. The Agents page tells a person to have their agent install `@skillcdn/console` from npm and run `console login --url <origin>`, in both languages.
- **The composition.** `createConsole({ pages })` adds tabs of the console's own: a `CustomPage` has a `key`, a `label` (one word, or by language tag), a `level` (`workspace` or `project`), `wide`, and `render(context)`, given the data of `useConsoleData` with its actions, the project, the client, the navigation, the words and the language; the address is `/pages/<key>` or `/projects/<project>/pages/<key>` (`customPageHref`), and `customPageLabel` is the tab's word. The router knows the route `custom`. The README now lists the stylesheet's tokens by group, for a console that sets its own look.
