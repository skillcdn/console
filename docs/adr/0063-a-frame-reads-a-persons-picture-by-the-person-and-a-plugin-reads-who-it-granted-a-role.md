# ADR-0063: A frame reads a person's picture by the person, and a plugin reads who was granted a role

- Status: Accepted
- Date: 2026-11-07
- Extends [ADR-0054](0054-a-plugins-pages-run-in-a-sandboxed-frame-and-speak-only-to-their-plugin.md) and [ADR-0048](0048-a-picture-from-elsewhere-is-read-through-the-console-from-a-public-address-and-kept-a-while.md). The contract is in [specs/plugins.md](../specs/plugins.md).

## Context

Going over what a plugin may read, against what the `hr` plugin's next pass is designed to do, turned up two things no plugin could do at all, whatever it asked for.

A page lists people, and `people:read` gives it `avatar`, an address at a git host. A frame loads no image from elsewhere (`img-src` is the plugin's bundle, `data:` and `blob:`), has no network, and carries no session, so the console's own pictures route is out of its reach. The faces the console's pages show could not be shown in a plugin's page.

A plugin names roles, and an administrator grants them. A plugin could ask which roles its caller holds, and never who holds one, so that a step of approval given to "the holders of `hr`" could not be written, nor could a job find whom to address. A plugin kept a second list of those people in its own settings.

## Decision

1. **A frame asks for a person's picture by the person.** `GET /api/v1/plugins/<key>/people/<id>/picture`, called through the bridge as `people.picture`, serves the picture of the person of that id, through the same cache and under the same guard as `GET /api/v1/pictures`. It takes no address: a frame that could name one could make the console ask a host of its choosing, and so carry out of the frame whatever it put in the address, which is what a frame without a network is for. It is open as `people` is: to a person in a role of the plugin, for a plugin that holds `people:read`, of the people that person may see, or of everyone with `people:read:all`.
2. **The SDK hands a page an address for an image.** `frame.people.picture(id)` answers a `blob:` address, which the frame's policy already allows, or `null` where there is no picture to show, and keeps it for the life of the frame.
3. **A plugin reads who was granted a role.** `ctx.console.people.granted(role)` answers the active people a role of the plugin was granted to, by name, through a project or with everyone, and everyone for `defaultRole`; under `people:read` as the person, under `people:read:all` for its hooks and jobs, as `people` is. An administrator holds every role but is not listed for it: the plugin asks who the role was given to, and someone who may configure the console is not thereby someone to address.
4. **The frame's workspace says what the server's does.** `frame.context.workspace` gains `name` and `languages`, so that a page that writes a text in every language of the workspace need not ask its server for the list.

## Consequences

- A role holder of a plugin with `people:read` can have the console fetch the pictures of the people they may see, which they could see on the People page anyway; the picture's origin learns nothing new, since the console asks for it, once in a while.
- The bridge stays closed to everything but the plugin's own path: the route is under `/api/v1/plugins/<key>/`.
- A hook or a job that addresses the holders of a role needs `people:read:all`, which an administrator reads before consenting.
- Rejected: opening `img-src` to the console's pictures route (the frame's origin is opaque, so that no session would reach it, and the address would be the frame's to choose); opening it to the git hosts (a viewer's address reaches the host, which ADR-0048 ended); listing administrators among the holders (every decision of a plugin would reach every administrator).
