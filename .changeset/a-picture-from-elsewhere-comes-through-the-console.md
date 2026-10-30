---
"@skillcdn/console": patch
---

Breaking: the pages load no picture from elsewhere. A picture named in Markdown over https, and a person's picture from the git host, are read through the console at `GET /api/v1/pictures?src=` (ADR-0048), which fetches it from a public address only, keeps it in memory a while and tells the browser to keep it a day, so that no origin learns who looks at a page; the content security policy a build is served under is `img-src 'self' data:`, so a custom console's own pages load their pictures from the build or through the same route. `Markdown` and `Avatar` read the address through the new `RemotePicturesContext`, which `createConsole` provides from the client's new `pictureUrl`; a component outside a composition reads it at the API's own path. `REST_ROUTES.pictures` names the route.
