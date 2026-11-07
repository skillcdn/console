# ADR-0064: A frame holds no WebRTC: every script of a bundle begins by taking it out

- Status: Accepted
- Date: 2026-11-07
- Extends [ADR-0054](0054-a-plugins-pages-run-in-a-sandboxed-frame-and-speak-only-to-their-plugin.md)

## Context

A frame has no way out but the bridge ([ADR-0054](0054-a-plugins-pages-run-in-a-sandboxed-frame-and-speak-only-to-their-plugin.md)), and [ADR-0063](0063-a-frame-reads-a-persons-picture-by-the-person-and-a-plugin-reads-who-it-granted-a-role.md) rests on that. WebRTC was the exception: `connect-src` does not govern it, so that a frame could name a STUN or TURN server of its choosing and reach it from the person's browser with what it was shown. A STUN packet was seen to reach a listener from a frame under the policy. The `webrtc` directive of a content security policy is known to no browser yet: Chromium logs it as unrecognized, and nothing changes.

Tried in Chromium, Firefox and WebKit, against a frame as the console serves one:

- **Taking the constructors out in a script that runs first** holds in the frame. A blank frame made inside it does not undo that: a child of a sandboxed frame has an opaque origin of its own, and is out of reach. A `srcdoc` frame does: it inherits the policy, so that a script of the bundle runs in it, in a realm of its own with WebRTC in it.
- **A nonce, to keep scripts out of a `srcdoc` frame.** The nonce is a secret a violation gives away (`originalPolicy`, `ReportingObserver`), and alone it lets a module import from any host, since a nonce passes whatever the host.
- **A second policy, so that a script must both come from the bundle and carry the nonce, or `strict-dynamic` in its place.** Holds in Chromium and Firefox. WebKit then lets `import()` reach any host, which trades one way out for another.

## Decision

1. **Every script of a bundle begins by taking WebRTC out.** The console serves a bundle's `.js` and `.mjs` with one line before the file, which deletes every global named `RTC...` or `webkitRTC...` from wherever it runs.
2. **The policy stays as it is.** A frame's code comes from the bundle's address alone, through that route: no inline script, no `eval`, no `data:` or `blob:` script. So no realm runs a line of a plugin's before that line, the frame or a frame made inside it, and nothing depends on a secret or on how a browser joins two policies.
3. **A file that shadows what the line reads fails it.** A hoisted `function globalThis() {}` would turn the line on itself: the line checks the name, and throws, and nothing of the file runs. A hoisted `Object` fails on its own. What a file can have in place when its first line runs is a function and nothing else, and an import comes from a file whose own first line has run.

## Consequences

- A frame has no WebRTC in any browser, and a plugin's page cannot use it, for a call or otherwise. If one comes to need it, that is a capability of its own to decide then.
- A script is served one line longer than it was built: a source map is a line out, and an `integrity` attribute of a plugin's own no longer matches.
- A bundle's files are cached as immutable by version, so that a browser keeps what it has of a version served before this until the version moves.
- Each browser has its own WebRTC, and a name the line does not know would not go. The line reads the names from the realm, so that what is added under those prefixes goes with it, and the browser test holds the list empty.
- Rejected: a nonce, and `strict-dynamic`, for the reasons above; a policy per browser, chosen by the `User-Agent`; the frame's DOM methods wrapped to keep `srcdoc` out, one of many ways to parse HTML; a `webrtc` directive, which would do nothing today.
