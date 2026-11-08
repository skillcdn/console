# ADR-0079: A secret is taken out of an answer in the encodings a service sends it back in

- Status: Accepted
- Date: 2026-11-08
- Amends [ADR-0075](0075-a-secret-never-comes-back-to-a-plugin-and-sealing-fails-closed.md), whose consequences left a percent-encoding with small hex digits, and the base64 of a secret placed anywhere but `basic`, uncaught. The contract is in [specs/plugins.md](../specs/plugins.md).

## Context

ADR-0075 takes every secret a request carried, and every value sealed or withheld, out of the answer in the forms it may come back in: as placed, escaped as JSON, URL-encoded, and for `basic` the base64 of the pair and the password. A service that echoes a request in its own encoding went past it: a URL encoded again with its hex digits small, JSON that escapes its slashes, a header or a body carried back in base64, whole or as part of a longer value encoded at once, in a URL's alphabet as often as a header's.

## Decision

The forms widen, for every placement:

- URL-encoded with the hex digits big or small, as a URL's part and as a query or a form encodes it;
- each form with its slashes escaped as some JSON spells them, and as it is;
- in base64, in a header's alphabet and a URL's: whole, padded or not, and inside a longer run of base64, at each of the three places its first byte may fall, without the letters it shares with what is around it. A value under 8 bytes is not looked for in base64, where its letters would turn up by chance; the pair of `basic` is, as the header carries it, whatever its length.

## Consequences

- A service that echoes a request in any of these encodings hands the plugin none of the secrets in it.
- A run of base64 in an answer that holds a secret loses its letters to `"[withheld]"` and no longer decodes there.
- An encoding the console does not know still goes past it; the forms are one list (`formsOf`), which a new one joins.
