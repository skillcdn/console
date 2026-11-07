# ADR-0066: WebRTC is a way out a plugin asks for, and how a frame is held stays in one place

- Status: Accepted
- Date: 2026-11-07
- Extends [ADR-0064](0064-a-frame-holds-no-webrtc-every-script-of-a-bundle-begins-by-taking-it-out.md), which left WebRTC as a capability of its own to decide when one came to need it, and [ADR-0060](0060-what-a-plugin-asks-is-required-or-optional-and-the-optional-are-the-administrators-to-choose.md), whose optional capabilities may be turned off at any time. The contract is in [specs/plugins.md](../specs/plugins.md).

## Context

A frame holds no WebRTC, and an administrator should be able to lift that for one plugin that needs it. Two things shape how.

`outbound:<host>` is the capability that reaches the internet, and it does not already say this. It names one host, and a person who consents reads one host. WebRTC goes to any address a page names, a STUN or TURN server or a peer, from the person's browser and past the console. Nothing can bound it to a host, since a page can name a peer's address in what it sets as the other side.

And how a frame is held will change. Today a line at the head of each script holds it. A browser may come to enforce a `webrtc` directive, frames may come to have an origin of their own, the plugins' host may move to a container of its own. What an administrator consented to must survive that.

## Decision

1. **`outbound:webrtc` is the capability, in the outbound family.** It says that the plugin's pages may use WebRTC. It is no host: a host has a dot, so that the two cannot meet, `ctx.fetch` finds nothing in it, and consent to a host does not open it. It is required or optional as any capability is.
2. **What it says and how it is held are apart.** `frameHoldsOf` reads what a plugin can go without and what its install holds, and `frameFile` serves a file of a bundle accordingly; both are in `apps/console/src/plugins/frame-holds.ts`, and nothing else in the console knows how a frame is held.
3. **A plugin that holds it is served its scripts without the line.** One that does not is served them as ADR-0064 says.
4. **A script whose first line can change is kept nowhere.** An optional capability may be withdrawn while the version stays, and a copy without the line, in a browser or a cache on the way, would undo that. A plugin that lists it as optional is served its scripts `no-store`; one that requires it or does not ask stays immutable for its version.
5. **A frame runs this version's scripts alone.** `script-src` names the version, so that what a browser kept of a version before cannot be run in a frame made inside this one.

## Consequences

- Withdrawn, the capability is gone from the next time a frame loads. A frame open at that moment keeps what it has until it is loaded again.
- The reach is the sentence on the form: what the plugin's pages are shown can go anywhere from the person's browser, with the person's address, and the console sees none of it.
- Camera and microphone do not come with it: the frame is allowed neither, and a call that needs them is a decision of its own.
- A plugin that lists it as optional loads its scripts on every frame.
- When a browser enforces a directive, or frames have an origin of their own, `frame-holds.ts` and the frame's policy change, the line and `no-store` can go, and no plugin and no consent changes. A host without a way out reads the hosts of `outbound:<host>`, among which this is not.
- Rejected: any `outbound:<host>` lifting it, which turns consent to one host into consent to every address; a family of its own such as `frame:webrtc`, which names where it is enforced and scatters the ways out across two families; a second address of the bundle per state, which moves the state into the frame's document, its policy and the route, for what one header settles on a rare plugin.
