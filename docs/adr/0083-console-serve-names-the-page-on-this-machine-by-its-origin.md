# ADR-0083: `console serve` names the page on this machine by its origin

- Status: Accepted
- Date: 2026-11-09
- Amends point 2 of [ADR-0014](0014-a-persons-own-console-is-served-from-their-machine-by-the-command.md), where the command stripped "the page's origin and referrer". The contract is in [specs/cli.md](../specs/cli.md) and [specs/plugins.md](../specs/plugins.md).

## Context

The command strips what is the browser's before it carries a request to the organization's console, the referrer among it: a token's request needs no page to vouch for it. The plugins came later. A plugin's frame document names the page that may embed it, in `frame-ancestors`, the bundle's addresses and `data-console`, and it reads that page from the request's referrer: the console's own `PUBLIC_URL`, or a loopback, which the spec allows so that a person's own console shows the plugins too ([ADR-0054](0054-a-plugins-pages-run-in-a-sandboxed-frame-and-speak-only-to-their-plugin.md)). With the referrer stripped, the console could not tell, and answered every frame of a console served by the command with a 404: its widgets and pages stayed blank.

## Decision

1. **The command passes on the referrer's origin, when it is on this machine.** A request whose referrer is a loopback page (`localhost`, `127.0.0.1` or `[::1]`, on any port) travels with `Referer: <origin>/`, its path, query and fragment left out. The command's own page is such a page, and so is a development server on this machine that sends its `/api/` requests to the command.
2. **Nothing else of the page travels.** A referrer anywhere else, or not an address, does not travel; `Origin`, cookies and the browser's own metadata are stripped as before, and a request from another site's page is refused as before.

## Consequences

- A plugin's widgets and pages show in a console a person serves from their machine, and in a development server in front of the command.
- The organization's console learns which port on the person's machine the page is on, which it needs to put in `frame-ancestors`, and no more of the page.
- Rejected: naming the command's own address whatever the page (a development server's page, on another port, could then not embed the frame); serving the frame from the command itself (a second copy of the console's frame document and its policy, to keep alike).
