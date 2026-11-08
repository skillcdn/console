# ADR-0078: A frame opens its links itself, and the browser holds it to a press in it

- Status: Accepted
- Date: 2026-11-08
- Amends [ADR-0067](0067-a-link-a-person-presses-in-a-frame-opens-in-a-new-tab-through-the-bridge.md), whose first point had a frame ask the console's page to open a link over the bridge, and whose third had the page open it "only right after a person pressed", asking the browser whether a press is recent. The page's side of that stays for the bundles built before this, and goes at the next line. The contract is in [specs/plugins.md](../specs/plugins.md), "The frame" and "The bridge".

## Context

A browser keeps whether a person pressed something for the whole page, wherever they pressed. ADR-0067 counted on a press in the frame to make the page's press recent, but any press did: on the console's own page, or in another plugin's frame, and a frame that kept asking the page to open an address had a tab opened for it at every press elsewhere.

The review before the release found that the page cannot mend this on its own side. It can tell which frame holds the focus, but not how the focus came there: a frame may take it itself, with no press, and a Tab pressed on the console's page gives the page a press and moves the focus into the frame at once. What a page sees of a frame is not enough to tell a press in it from a frame that acts as if there were one.

The browser sees it. A sandboxed frame allowed to open windows (`allow-popups`) opens one only while its own press is recent, since a press in a frame counts for the frame and for the pages above it and for nothing beside, and the press is spent on the window it opens. ADR-0067 set that way aside as letting a frame open "any address, with any scheme, whenever its code likes": whenever is wrong, since the browser holds the frame to a press; and the frame's own SDK refuses the schemes that run or read before any of it, as ADR-0067 had it refuse them.

## Decision

1. **A frame opens its links itself.** The sandbox allows `allow-popups` and `allow-popups-to-escape-sandbox`, in the document's policy and on the page's `<iframe>` alike, and `frame.open(url)` opens a web or a mail address in a new tab from inside the frame, with no opener and no referrer, refusing anything else as before, and refusing a call with no recent press where the browser says so. The window a frame opens is a page as any, out of the sandbox, and knows nothing of the console: no opener, no referrer, no cookie.
2. **The browser holds the frame to a press in it,** as a browser has it: a press in a frame is the frame's and the pages above it, a press on the console's page or in another frame is not the frame's, and where the browser blocks the windows a page opens on its own, as every browser people use does unless told otherwise, no window opens on the frame's own time or for a press elsewhere, and one press opens one window. The console's page does nothing for it, and cannot be mistaken about it. The frame's SDK refuses a call with no recent press itself, where the browser says so, so that a frame opens nothing on its own time even where that blocking is off.
3. **The page's `open` stays for the bundles built before this,** which still ask the page: it opens a link for one as far as it can tell of a press, while a press is recent and the frame holds the page's focus, and takes the focus back as it opens the tab, so that another tab takes another press. It goes at the next line of SkillCDN, with the frames that asked.

## Consequences

- A link in a plugin's page opens as a link does anywhere, for the press that followed it and for nothing else, and the console's page has no part in it.
- `frame.open` needs a console from 0.4.6; a plugin that calls it says so in its manifest's `console`.
- An opener a plugin's own `window.open` would leave reaches nothing: the console's page admits no frame but its own under `frame-src 'self'`, so the window it opened cannot send the frame elsewhere.
- A browser test holds what the test browser can show: left alone, a frame holds no press and opens nothing, and for a press in it the sandbox lets it open a window; the page's side, for the older bundles, is held by one as far as it goes. The test browser blocks no window a page opens on its own, and hands a press to every frame of a page whenever a test asks the page anything, so what a browser does with a press elsewhere is the browser's word, not the test's. The SDK's refusal where the browser says there was no press is held by a unit test.
- Rejected: the page telling a press in a frame by its focus alone, which a frame may take itself; the page noting its own presses and refusing a frame's for a while after each, which refuses a person's press in the frame right after one on the page and still tells nothing of a frame that takes the focus; confirming each link, which makes a link a dialog.
