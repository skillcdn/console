# ADR-0075: A secret never comes back to a plugin, and sealing fails closed

- Status: Accepted
- Date: 2026-11-08
- Amends [ADR-0070](0070-a-secret-is-sealed-by-the-console-from-an-answer-and-goes-where-its-setting-says.md), whose point that a value which is not there, not a string, or over the bound "seals nothing and is left as it is" this replaces, and which said nothing of where a sealed value may come from or of what an answer carries back. The contract is in [specs/plugins.md](../specs/plugins.md).

## Context

ADR-0070 lets the console seal a secret from an answer the plugin received, so that a plugin that exchanges a code for a token never reads the token. The review before the release that carried it found three ways the plugin read a secret all the same.

- **Sealing failed open.** An answer that was not JSON, a value over the bound or not a string, or a path that led nowhere came back to the plugin whole, and nothing said so. A token endpoint that answers a form unless it is asked for JSON, as some do, handed the plugin the very token it believed sealed, to keep in a record or to log.
- **A seal ignored the setting's hosts.** A secret pinned to hosts, or kept only to verify a signature, was sealed from the answer of any host the plugin may call, so that another host could put a token, or a signing secret that then lets forged webhooks through, in its place.
- **A placed secret came back.** The method check let `TRACE` through, which has a server send the request back with its authorization; a secret placed in a query came back in a redirect's `location`; and the answer reached the plugin as it came.

## Decision

- **A value named to seal never reaches the plugin.** The answer says, under `sealed`, what became of each setting it named: `sealed`; `absent`, where the path holds nothing, the answer left as it is so that a service's error stays readable; `not_a_string`, `too_long` or `echoed`, never sealed, the value replaced by `"[withheld]"`; or `not_json`, where the answer is no JSON object or array and its whole body is withheld.
- **A secret is sealed from its hosts' answers alone.** Where the setting declares `hosts`, a request that names it to seal goes to one of them or is refused before it goes out (`plugin.forbidden`), as every other check of a seal is.
- **A value that holds a secret the request carried is not sealed** into another setting (`echoed`), so that a host that echoes cannot carry a pinned secret into a setting that goes anywhere. Sealing into the same setting again stays allowed, for a refresh token that comes back unchanged.
- **Nothing a request carried comes back.** `ctx.fetch` takes `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE` and `OPTIONS` alone. Every secret the console placed in the request, in each form it may come back in (as placed, escaped as JSON, URL-encoded, and for `basic` the base64 of the pair and of the password), and every value sealed or withheld, is taken out of the answer's headers and body before the plugin reads them. Redirects are not followed, as before.

## Consequences

- A plugin learns from `sealed` whether its token was kept, and tells a token sealed from one it never received; one that asks a token endpoint for a form gets no body, and asks for JSON instead.
- A plugin that speaks WebDAV or CalDAV with `PROPFIND` or `REPORT` cannot through `ctx.fetch`; one that needs another method asks for it, and it is decided then.
- The scrubbing is of what the console placed and in the forms named: a service that sends a secret back in another encoding, a lowercase percent-encoding or the base64 of a header that is not `basic`, is not caught; a very short secret is taken out wherever its characters occur, which can garble an answer, and a secret is long in practice.
