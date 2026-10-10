---
"@skillcdn/console": patch
---

`console serve [<dir>] [--port <n>]` serves a console of your own from your machine ([ADR-0014](https://github.com/skillcdn/console/blob/main/docs/adr/0014-a-persons-own-console-is-served-from-their-machine-by-the-command.md)): the build in `<dir>` at `http://127.0.0.1:11197/`, and everything under `/api/` carried to the console the command is signed in to with your token, which the pages never see. The loopback only; a request whose host is not it, or that the browser says comes from another site's page, is refused. Without a directory only the API is served, for a development server to send its `/api/` requests to. The serving of a build is now the package's, at `@skillcdn/console/web` (`loadWebRoot`, `WebRoot`, `WebRootError`; Node only), which the image uses for the default UI. The README says how a console of your own is built.
