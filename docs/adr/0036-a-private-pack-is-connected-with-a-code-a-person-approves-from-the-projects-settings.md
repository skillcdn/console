# ADR-0036: A private pack is connected with a code a person approves, from the project's settings

- Status: Accepted
- Date: 2026-10-18
- Amends point 2 of [ADR-0028](0028-the-console-reads-a-projects-pack-through-the-deployments-rest-api-with-a-pack-token-for-a-private-one.md), which stands otherwise. The contract is in [specs/rest.md](../specs/rest.md#post-apiv1projectskeypack-tokenconnect-get-pack-tokenconnect-and-delete-pack-tokenconnect) and [specs/cli.md](../specs/cli.md).

## Context

A private pack is read with a pack token the project holds (ADR-0028): a token a person made by hand on their account page at the deployment and pasted into the project's settings, or piped into the command. The main repository's 0.3.1 gave a command a better way to such a token (its ADR-0059): it asks the deployment to connect, as nobody, the deployment answers a code and the page to approve it on, the person approves there signed in, and the command claims the token with a secret it was handed, never seeing the token on a page. The console is a program that holds a repository token the same way, and the paste was the step the first organization stumbled on: a token made on another site, copied through a clipboard, pasted into a form.

## Decision

1. **The console connects a project's pack as the `skillcdn` command connects.** An owner asks, from the project's Settings page or with `console project pack-token <key> --connect`; the console asks the deployment to connect the project's address, as nobody, calling itself `<the workspace's name> console`; the deployment answers the code, the page, a secret and until when; the console shows the owner the code and the page and keeps the secret, sealed with its own secret, on a row of the project's; the person approves on the deployment's own pages, signed in as someone who may open the repository; the console asks the deployment again at the interval it named, and, once approved, receives the token and keeps it as ADR-0028 has it, sealed on the project, shown to nobody. The paste stays, for a token made by hand.
2. **The request is the project's, one at a time.** Beginning again replaces the one under way; an owner gives it up; the row goes when the token is claimed or the request ended, expired at the deployment's time or declined there. The deployment's secret is answered and logged nowhere, as the token is.
3. **What the deployment refuses, the console says in its words.** A pack on the console's machine, or a project that names none, is not connected; an address with a ref or a path, a repository the person may not open, a public pack and a person who holds as many tokens as one may are the deployment's refusals, passed on; a deployment that cannot be reached is said to be away, and asked again.
4. **The way is written where a person first meets a private pack.** The README, the deployment contract, the skill that deploys a console and the skill that works the board say how a private pack is connected, so that an agent setting a console up does not stop at a pack it cannot read.

## Consequences

- An owner connects a private pack in two steps on the console's own pages and the deployment's, copying nothing; an agent runs one command and relays the page and the code.
- The console holds a second sealed value, for minutes: a deployment without `AUTH_SECRET` connects nothing, as it keeps no pack token.
- The deployment must be one that connects commands with a code (SkillCDN 0.3.1 or later), which `skillcdn.ai` is; an older one refuses to begin, and the console says so.
- Rejected: the console as an MCP client of the deployment (ADR-0028 stands); a token per person on the console (the project is what the board shares); the console's own connect pages for the pack (the approval is the deployment's, which knows who may open the repository); keeping the deployment's secret in memory (several replicas answer the polls).
