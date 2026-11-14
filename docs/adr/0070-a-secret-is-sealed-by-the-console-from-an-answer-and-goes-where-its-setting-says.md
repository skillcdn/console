# ADR-0070: A secret is sealed by the console from an answer the plugin received, and goes where its setting says

- Status: Accepted; what a value that cannot be sealed becomes, where a seal may come from, and what an answer carries back are amended by [ADR-0075](0075-a-secret-never-comes-back-to-a-plugin-and-sealing-fails-closed.md), sealing failing closed and nothing a request carried coming back; a secret of a number not fixed is kept per key under [ADR-0111](0111-a-secret-setting-may-keep-one-value-per-key.md)
- Date: 2026-11-08
- Extends [ADR-0050](0050-plugin-code-runs-in-a-host-process-of-its-own-and-reaches-the-console-only-through-the-capabilities-it-declared.md), under which a plugin's secrets are set by an administrator, sealed by the console and put into a request by the console where the plugin names them, never read by the plugin. The contract is in [specs/plugins.md](../specs/plugins.md).

## Context

A plugin that connects the console to a service elsewhere often cannot be given its credentials by hand. An administrator pastes one short-lived token; with it the plugin registers an app at the service and receives a client secret and a signing secret in the answer; a person approves the app in a new tab and the plugin exchanges the code for a bot token, which the service rotates, and the answer says when. Every one of those values is a secret, and every one arrives in an answer to a request the plugin made.

Under ADR-0050 a secret reaches the console from an administrator alone, one per request, in a header, a query parameter or as basic authentication, and the plugin never sees a value. An answer, though, came back to the plugin whole: a token in it was the plugin's to read, to keep in a record and to log, against rule 1, or it was lost. A plugin could paste `Bearer` and the token into one header by hand, and a token exchange needs two secrets in one request, in the body. And a secret an administrator set for one host went into a request to any host the plugin was allowed to reach, and a secret meant for verifying a service's signatures could sign a request to it.

## Decision

The console seals a secret from an answer, where the plugin says which, and the plugin reads the answer without it.

- **Sealed from the answer.** `ctx.fetch(url, { seal: { <setting>: "$.path" | { path, expiresIn } } })` names values of the answer's JSON, each by the key of a `secret` setting the manifest declares. The console reads the answer first, seals each value named as that setting, with its expiry where `expiresIn` gives the seconds or a path to them, and hands the plugin the answer with `"[sealed]"` where each value stood. A value that is not there, not a string, or over the bound of a secret seals nothing and is left as it is. The seals are checked before the request goes out, so that a request with a side elsewhere is not made for a seal the console would refuse.
- **Several secrets, in more places.** A request carries `secret` or `secrets`, five at most, each put where `as` says: `header:<name>`, `bearer` for `Authorization: Bearer`, `query:<name>`, `basic`, or `body:<field>` in a JSON object or a form body, which the console reads and writes again. The plugin never holds a value beside the rest.
- **Where a secret goes, and what it does.** A `secret` setting may name `hosts`, as `outbound:<host>` names one: the secret goes into a request to those hosts and no other, whatever else the plugin may reach. A setting with `use: "verify"` verifies signatures and signs nothing, and goes into no request, so that a secret for checking what a service sent cannot forge a request to it.
- **Expiry and standing.** A secret keeps `expires_at` and `source`: `administrator` for one set by hand, the host of the answer for one sealed from it. A secret past its expiry stands unset, to `has`, to a request and to signing, until it is set or sealed again; renewing it is the plugin's job, which reads `ctx.secrets.status(name)` for `{ set, setAt, expiresAt, source }`. The settings page and `console plugin <key> settings` say from where and until when, never the value.
- **Recorded, never shown.** A seal is the setting's change (`plugin.configured`, with `source` the host), by the caller whose command made the request, or by the administrator who enabled the plugin where the console's own job or hook made it, as the board attributes those. The feed says a secret was sealed from a host's answer, and never what it was.

## Consequences

- A plugin installs itself at a service and renews its tokens without a person carrying a secret, and without ever holding one: the messenger's automatic installation works as designed, and any integration with a token exchange does.
- Reading the answer to seal from it is bounded as the answer is: the console parses what it already reads whole, and seals at most five values per request.
- A secret an answer named with a life longer than ten years lives ten years, as a collection's retention goes; an expired secret stays in its row, unset to every use, until replaced, so that the page can say it expired.
- What stays with ADR-0050: the plugin never reads a value, the console puts it in and takes it out, and an administrator consents to each host. A secret of an unbounded number, one per channel, and a placement in a URL's path, and signing with RS256, wait for tasks of their own.
