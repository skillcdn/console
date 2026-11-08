# ADR-0078: A frame opens a tab only for a press in it, one tab a press

- Status: Accepted
- Date: 2026-11-08
- Amends [ADR-0067](0067-a-link-a-person-presses-in-a-frame-opens-in-a-new-tab-through-the-bridge.md), whose third point had the page open a link "only right after a person pressed", by asking the browser whether a press is recent. The contract is in [specs/plugins.md](../specs/plugins.md), "The bridge".

## Context

A browser keeps whether a person pressed something for the whole page, wherever they pressed. ADR-0067 counted on a press in the frame to make the page's press recent, but any press did: on the console's own page, or in another plugin's frame. A frame that kept asking the page to open an address had a tab opened for it at every press elsewhere. Nor may the page count on the browser to hold a press to one tab: the browser the tests drive opens whatever a page asks.

## Decision

1. **The press must be in the frame that asks.** A press in a frame gives it the page's focus, and a press anywhere else takes the focus there; the page opens a link only while the frame that asks holds the focus and the press is recent.
2. **One press, one tab.** The page takes the focus back from the frame as it opens the tab, so that another tab takes another press in the frame.

## Consequences

- A frame opens no tab on the console's press, on another frame's, or several on its own.
- After a link opens, the keyboard's focus is on the console's page rather than on the link in the frame: a person who comes back with the keyboard steps into the frame again.
- A browser test holds both, in a browser that opens whatever a page asks, so that what is seen to refuse is the page.
