# ADR-0014: A person's own console is served from their machine by the command, with the token it keeps

- Status: Accepted
- Date: 2026-10-10

## Context

The package is meant for two kinds of custom console ([architecture.md](../architecture.md)): the organization's, which replaces the default UI the image serves, and a person's own, which a member builds from the package and runs for themselves against the organization's console, with pages and components of their choosing. The second talks to the REST API and the feed with a token of the person's ([ADR-0004](0004-people-and-agents-reach-the-board-only-through-the-api-with-a-credential-of-their-own.md)). How it reaches the organization's console was open question 9: served by the console from a build the person uploads, or run on their machine and allowed as an origin with their token. Milestone 7 of the [roadmap](../roadmap.md) decides it.

## Decision

1. **A person's own console is a build served from their machine by the command.** `console serve <dir>` serves the build (its `index.html` and files) on the loopback, at `http://127.0.0.1:11197/`, and carries everything under `/api/` to the console the command is signed in to, with the token `console login` kept, as `Authorization: Bearer`. Without a directory it serves the API alone, for a development server to send its `/api/` requests to while the console is being built.
2. **The page and the API share one origin, and the token never reaches the page.** The page calls `/api/...` on its own origin; the command adds the token on the way and strips what is the browser's: cookies, the page's origin and referrer, what the browser says of the loopback. The organization's console sees a token's requests, as it sees the command's; it allows no other origin and configures nothing for it.
3. **The loopback only, and the person's own page only.** The command listens on `127.0.0.1` and answers no request whose host names another address, which is a page elsewhere whose name was made to resolve here. A request to the API that the browser says comes from another site's page is refused; a browser too old to say is held to the page's origin on a request that changes something; a request that says nothing of either is not a browser's.
4. **The API says with what a request acts.** `GET /api/v1/me` answers `agent`, the name of the token when a token asks and `null` on a session, so that a console that holds a token offers nothing a token cannot do: the tokens themselves and configuring stay a person's own doing on the console's own pages ([ADR-0011](0011-an-agent-connects-with-a-short-code-a-person-approves-and-the-token-is-never-shown.md)), and the pages say so where it matters; the choice of language is kept in the browser, since a token cannot keep it on the person.
5. **The serving of a build is the package's**, at `@skillcdn/console/web`: the files, the page for every other path, the policy that runs nothing inline. The image serves the default UI with it from `WEB_ROOT`, and the command serves a person's own build with it: one policy for both.

## Consequences

- A person's console needs nothing of the organization's deployment: no origin to allow, no build to upload, no page served under the console's origin with their code in it. What they build is theirs, on their machine, with their standing and no more.
- The token the command keeps is the token the person's console runs on: `console login` once serves an agent and a console alike, and removing the token on the Agents page ends both.
- A token cannot do everything a session can, by design: a person configures on the organization's console, and a console of their own shows the board.
- The command grows a server on `node:http` and nothing else, and the package a Node-only entry point; `apps/console` serves its build through it instead of a module of its own.
- Rejected: a build the person uploads, served by the console under its own origin (the person's code would run with the session of whoever opens it, an administrator's included); the person's page talking to the console from its own origin, with the token in the browser (a token copied by hand into a page and kept by the browser, and every person's origin allowed on the organization's console); a second server with a database of its own (a console of one's own shows the organization's board, and holds nothing).
