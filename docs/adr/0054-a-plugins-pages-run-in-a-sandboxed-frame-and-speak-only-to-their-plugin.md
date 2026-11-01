# ADR-0054: A plugin's pages run in a sandboxed frame and speak only to their plugin

- Status: Accepted
- Date: 2026-11-01

## Context

A plugin has pages for people. Code that runs in the console's own document runs as the person: with their session it may call every route of the API, and on an administrator's screen it may change the workspace. The server side of a plugin is bounded by capabilities ([ADR-0050](0050-plugin-code-runs-in-a-host-process-of-its-own-and-reaches-the-console-only-through-the-capabilities-it-declared.md)); its pages would be the open door. Plugins also need tabs of their own, several plugins under one tab, pages under one plugin, and a place on the front page for a figure or a briefing.

## Decision

1. **A frame of its own.** A plugin's page is a document the console serves, under a content security policy of its own that loads the plugin's bundle from the console's address and nothing else, connects nowhere, and is sandboxed, in the policy and on the frame. Its origin is opaque: no cookie, no session, no reach to the API. The bundle is prebuilt in the package, served by the console from the plugins directory under the plugin's version, immutable; it bundles whatever framework it likes.
2. **A bridge, allow-listed.** The console's page and the frame speak over `postMessage`, each accepting the other alone. The frame may call its own plugin's commands, queries, records and files, subscribe to its plugin's events, ask to navigate within the console, say its height and its title, and ask for a download; the console performs the calls with the person's session under `/api/v1/plugins/<key>/` and refuses every other path. A page thus holds exactly the authority of its plugin's server module, as the person using it.
3. **The console draws the navigation from the manifest.** A plugin names a group, one of the console's or one it declares; a group with one plugin is a tab with the plugin's name, a group with several a tab with the group's name that opens the list of them; a plugin with several pages has a row of sub-tabs the console draws above the frame. The addresses are `/plugins/<key>/<page>` and, on a project, `/projects/<pkey>/plugins/<key>/<page>`, the rest of the path handed to the frame. A person without a role sees no tab and finds no page.
4. **Widgets.** A manifest may declare widgets for the front page, above or below the projects, each a frame with the same bridge, a third, a half or the width wide, shown to the roles it names.
5. **The look travels in.** The console sends the frame its computed design tokens and the person's language, the frame's SDK applies them, and the console's stylesheet is served for frames at a fixed address; tokens for figures and states (`info`, `neutral`, a series palette, tabular numerals) are added to the console's set. A plugin's classes carry a prefix of their own.
6. **The settings are the console's pages.** Enabling, consent, the board project, the projects, the settings form, the secrets, the grants and the plugin's activity are the console's own pages under `/settings/plugins`, built from the manifest, with no plugin code on them.

## Consequences

- Installing a plugin rebuilds no pages ([ADR-0049](0049-a-plugin-is-an-npm-package-installed-into-the-image-and-enabled-by-an-administrator.md)); a custom console shows plugin tabs with no composition of its own.
- Dialogs and popovers stay within the frame, which is near a page of its own: acceptable for pages that are an application in themselves.
- Each bundle carries its own framework; a plugin's page knows of the console only what its own server tells it.
- The frame and the bundle are served to anyone, so a bundle holds no secret; the policy names the console's address from `PUBLIC_URL`, or the loopback a person's own console is served on ([ADR-0014](0014-a-persons-own-console-is-served-from-their-machine-by-the-command.md)).
- Rejected: pages composed into the console's build (the person's whole authority, and a build per deployment); a second origin for frames (a hostname per deployment); a frame on the console's own origin (the cookie travels).
