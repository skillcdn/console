# ADR-0067: A link a person presses in a frame opens in a new tab, through the bridge

- Status: Accepted; the first and third points are amended by [ADR-0078](0078-a-frame-opens-its-links-itself-and-the-browser-holds-it-to-a-press-in-it.md): since 0.4.6 a frame opens its links itself, held to a press in it by the browser, and the page's `open` stays for the bundles built before, until the next line
- Date: 2026-11-08
- Extends [ADR-0054](0054-a-plugins-pages-run-in-a-sandboxed-frame-and-speak-only-to-their-plugin.md), under which a frame speaks to the console's page over the bridge alone, and [ADR-0066](0066-webrtc-is-a-way-out-a-plugin-asks-for-and-how-a-frame-is-held-stays-in-one-place.md), which keeps how a frame is held in one place. The contract is in [specs/plugins.md](../specs/plugins.md), "The bridge".

## Context

A plugin's page shows links to the web: the form an announcement points at, a customer's site, a portal, the page a messenger's authorization is given on. A frame can open none of them. Its sandbox has no `allow-popups`, so `target="_blank"` and `window.open` do nothing; going to the address in the frame itself fails on the console's `frame-src 'self'`; and `navigate` on the bridge takes a path of the console's and refuses a URL. The first plugin copied the address for the person to paste into a new tab, which is not how a link works, and the second needs an authorization page to open as part of installing an app, where copying and pasting is not an install.

Two ways were open: `allow-popups allow-popups-to-escape-sandbox` on the sandbox, which lets the frame open windows itself; or a message on the bridge, which the console's page acts on. The first is shorter and leaves the console nothing to look at: the frame opens any address, with any scheme, whenever its code likes. The second keeps every way out of the frame on one list the console reads.

## Decision

1. **A frame asks the page to open a link: `open`, with the URL, on the bridge.** `frame.open(url)` in `@skillcdn/console/plugin/web` sends it. The sandbox stays as it is.
2. **The page opens a web or a mail address and nothing else.** `https:`, `http:` and `mailto:`, absolute, one line, within a bound; anything that runs or reads (`javascript:`, `data:`, `blob:`, `file:`) and any path of the console's is refused on both sides, the frame's SDK throwing and the page dropping the message unread. A path of the console's is `navigate`'s.
3. **The page opens it only right after a person pressed.** A press in the frame counts for the page too, which is what lets the page open a tab for it; the page asks the browser whether a press is recent and does nothing otherwise, so that a plugin's code cannot open tabs on its own time. The tab opens with no opener and no referrer.
4. **No confirmation, and no capability.** A link a person pressed opens as a link does anywhere; a plugin's page could already send what it is shown to any address the person follows, and the reach of a press is small.

## Consequences

- A link in a plugin's page opens in a new tab, as a person expects; an install that needs a page elsewhere opens it from a button.
- What the frame may ask stays one list: the bridge's. A change in how frames are isolated changes the page's side and no plugin.
- A page the frame opens knows nothing of the console: no opener, no referrer, no cookie.
- The way out is a person's press, so a plugin learns nothing by it that the person did not choose to follow; the address may carry what the page was shown, as any link the person follows may.
- Rejected: `allow-popups` on the sandbox, which opens any scheme at any time with nothing for the console to check; a confirmation before every link, which makes a link a dialog; a capability for it, which an administrator would consent to for every plugin that shows a link.
