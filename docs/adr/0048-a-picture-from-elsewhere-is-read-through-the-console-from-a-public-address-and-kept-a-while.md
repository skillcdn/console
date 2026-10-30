# ADR-0048: A picture from elsewhere is read through the console, from a public address, and kept a while

- Status: Accepted
- Date: 2026-10-30
- Amends the security model of [architecture.md](../architecture.md): outbound requests go only to configured addresses, with the one exception made here.

## Context

A task, a comment, a report, a decision or a page may name a picture in Markdown, `![words](https://...)`, and the pages loaded it from where it was named (`img-src https:`); a person's picture came from the git host the same way. Every look at such a page told the origin the viewer's address, time and browser, and a picture placed in a decision or a page told whoever placed it who read it and when. On the public console, where outside builders write and customers read, that is a leak; on any console it is one the pages did not have to make.

## Decision

1. **The pages load nothing from elsewhere.** A picture from elsewhere, named in Markdown over https or served by a git host as a person's, is read at `GET /api/v1/pictures?src=`, where the console fetches it and hands it over; the content security policy of the pages is `img-src 'self' data:`. The `Markdown` and `Avatar` components read it through `RemotePicturesContext`, which the composition provides from the client, and which falls back to the API's own path.
2. **The console fetches from a public address only, under a guard of its own.** The address must be https, on its default port, with no credentials. The host is resolved first, and refused when any address it resolves to is the console's own: loopback, private, link-local, where a platform hands a container its credentials, shared, test and reserved ranges; the connection is made to the address checked, under the host's name, so that a name resolved again cannot lead elsewhere; a redirect is followed a few times under the same rule. Nothing is read but what says it is a picture, no larger than a file handed in, within a short time. This is the one exception to outbound requests going only to configured addresses, and the guard is what makes it one.
3. **What was fetched is kept a while, in memory, within a bounded room.** Served as it was for an hour, asked after again with what the origin said it was, kept and served for a day when the origin is away, and let go of oldest first when the room is full; a refusal is kept five minutes. One fetch at a time per address, however many look. The browser is told to keep a picture a day and ask with its tag after, so that a picture on a board costs the origin one fetch for everyone and a viewer one download a day.
4. **A picture that cannot be fetched is its words.** The pages show the text of a picture from elsewhere where the console refuses or cannot reach it; nothing waits on it.

## Consequences

- No origin learns who looks at the console's pages; what the origin sees is the console, once in a while.
- The console reaches out to addresses people wrote, which it never did: the guard is a security boundary and is tested as one, and a deployment on a closed network shows words where such pictures were.
- A custom console built on the package loads no picture from elsewhere either: a picture of its own pages is in its build, or read through the same route.
- Rejected: showing a picture from elsewhere only after a click (every picture a click, and the click still tells the origin who looked); keeping the pictures in the blob store (storage and reads for what the memory holds well enough, and a cleanup to write); allowing the git hosts' picture addresses in the policy and proxying the rest (two rules where one serves, and the hosts learn who looks).
