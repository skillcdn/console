# Hello

A plugin of the SkillCDN Console, written from the template `console-plugin init` ships: greetings kept as records, a command that greets, a query that reads the latest, a page and a widget that show them, and a skill an agent reads first.

The contract is `docs/specs/plugins.md` of the console's repository, shipped in `node_modules/@skillcdn/console/docs/specs/plugins.md`: every field of the manifest, every member of `ctx`, every bound and every refusal is there.

## Where things are

| Path | What |
|---|---|
| `console-plugin.json` | The manifest: what the plugin is and asks, as data |
| `src/server/index.ts` | The server module: collections, commands, queries; `definePlugin` is its default export |
| `src/web/index.ts`, `src/web/index.css` | The web bundle: the page and the widget, speaking to the console through the bridge |
| `skills/`, `SKILLCDN.md` | The skills an agent reads, in the SkillCDN Format |
| `build.mjs` | The build: two bundles into `dist/` |

## Working on it

```sh
npm install
npm run build        # dist/server/index.js and dist/web/
npm test             # the server module against an in-memory context, and the package as a console reads it
npm run check        # console-plugin check: what a console, or a store, would refuse
```

To try it on a console of your own, point `PLUGINS_DIR` at a directory that holds this package under `node_modules/`, as the image does, and enable it on the settings page.
