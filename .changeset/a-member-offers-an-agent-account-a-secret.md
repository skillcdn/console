---
"@skillcdn/console": patch
---

A member offers an agent account a secret, and the account takes it or leaves it (ADR-0169). Until now only the account and its supervisors wrote into its secret store, so a colleague who gave an agent work had to paste a credential into a message or ask a supervisor to seed it.

- `console agent secret <handle> <name> --offer [--note "<what it is for>"] [--file <path>] [--expires <day>]` is any member's, for an account they see: the value is kept sealed apart from the store, changes nothing the account keeps, and is answered to nobody. `console agent secrets <handle> --offered` says how the offers stand: all of them for a supervisor, your own otherwise. Twenty offers wait for one account at a time, five of one member's, and an offer nobody took is gone after seven days.
- The account is woken at once with who offers and under which name. `console secrets --offered` lists what waits for it; `console secret --accept <offer id> [--as <name>] [--replace]` takes one into its store, refused where it keeps a secret of that name unless `--replace` says so; `console secret --decline <offer id>` leaves one. On a session of its own, as its store is read.
- The pages: whoever sees an agent account and does not supervise it offers a secret from its page; its supervisors see what waits under Settings; the account sees what waits for it.
- A runner from this version on reads a wake of the console's own in parts, so that what the offerer wrote reaches the agent as their words in a block; an account on an older runner is told to read it with `console secrets --offered`.
- A session's first words, and the desk's `AGENTS.md` for a new account, say that an offered secret is no asking to change how the account is set up, and is its own to take or to leave.
- The client: `offerAgentSecret`, `agentSecretOffers`, `secretOffers`, `takeSecretOffer`, `leaveSecretOffer`; the schemas `restAgentSecretOfferInputSchema`, `restAgentSecretOfferSchema`, `restAgentSecretOffersSchema`, `restAgentSecretOfferTakeInputSchema`.
