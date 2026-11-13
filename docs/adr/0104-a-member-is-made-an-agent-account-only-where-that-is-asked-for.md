# ADR-0104: A member is made an agent account only where that is asked for

- Status: Accepted
- Date: 2026-11-14
- Amends point 3 of [ADR-0084](0084-an-agent-account-is-a-member-of-its-own-with-a-manager-above-it.md), which had a login a member already carries made an agent account "the same way, once", by naming it and nothing more. The rest of that decision stands.

## Context

An administrator makes an agent account by naming the account it signs in with. Where a member already signs in with that login, the member's own row becomes the account, with everything it did, and `kind` never goes back: that is how an account that began as a person's is turned into the agent's, and it is meant to be possible.

It was also what happened by accident. The form proposes a persona and puts the login together from its handle and the workspace's names: a proposal called Flora, at a workspace whose addresses are `<name>@acme.example`, names `flora@acme.example`, which may be a colleague's. The form said nothing of it, the route asked nothing, and the colleague was an agent account from then on, for good: their role kept, their name and picture replaced by the persona's, a manager put above them, and no way back short of the database.

## Decision

1. **Naming a login a member carries makes nobody an agent account.** `POST /api/v1/agents` refuses it with `409` `agent.login_is_member`, and changes nothing.
2. **Whoever makes the account says so where that is what they mean.** The input takes `convert: true`: with it, the member is made the account as ADR-0084 has it, once, unless they administer the workspace (`agent.administrator`) or are an agent account already (`agent.exists`), which no word changes. `convert` asks nothing of a login nobody carries: such an account is made as any is.
3. **The pages and the command ask first.** The form finds the member among the people it has, says who they are and that it is for good, and sends nothing until the box beside those words is ticked; `console agent new` takes `--convert`, and without it says the two ways on: the agent's own login, or the flag.

## Consequences

- The rule reads no `kind` beyond what ADR-0084 reads already: it is about a login that is taken, whoever holds it.
- A command of 0.5.0 built before this sends no `convert`: against a member's login it is refused, in words that name the flag. Nothing released sent the route anything, so no client breaks.
- The form's check is by the people an administrator sees, which is everyone; where it finds nobody and the console still refuses, the refusal's words say what to do.
- Rejected: a confirmation only on the pages (the route would still convert for a script or an agent holding an administrator's token, and the accident is as easy to make there); refusing a member's login outright (turning a person's account into the agent's is the case ADR-0084 decided for, and stays possible); a way back from an agent account to a person (`kind` never going back is what keeps what an account did attributable to what it was when it did it).
