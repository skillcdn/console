---
"@skillcdn/console": patch
---

A plugin's frame allows forms: `PluginFrame` embeds the frame with `sandbox="allow-scripts allow-forms"`, as the frame document's own policy now says, so that a form on a plugin's page fires its `submit` event, which a browser dropped with the submission before; `form-action 'none'` in that policy keeps a submission from going anywhere, so the page handles the event itself and speaks over the bridge. Found by the browser tests the repository gained (`pnpm test:browser`), which also found that a module script is fetched with CORS from the frame's opaque origin: a console answers the bundle's files and the frames' stylesheet with `access-control-allow-origin: *`.
