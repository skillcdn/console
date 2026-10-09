---
"@skillcdn/console": minor
---

Tokens that do not expire, for a person who chooses so: `restTokenInputSchema` takes `expiresInDays: null` for one, `restTokenSchema.expiresAt` is `null` for it, `TokenForm` offers "Does not expire" among its spans, and `TokenList` and `NewToken` say so.
