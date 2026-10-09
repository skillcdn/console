---
"@skillcdn/console": minor
---

Tokens a person makes for their agents, scripts and consoles of their own. The API layer gains the contract of `/api/v1/tokens` (`restTokenSchema`, `restTokensSchema`, `restTokenInputSchema`, `restTokenCreatedSchema`, the bounds `MAX_TOKEN_NAME_LENGTH`, `MAX_TOKEN_DAYS`, `DEFAULT_TOKEN_DAYS` and `MAX_TOKENS_PER_PERSON`), the client gains `tokens()`, `createToken()` and `revokeToken()`, and `createClient({ token })` presents a token as `Authorization: Bearer` on every request, with no cookie, so that a script or a console of a person's own acts as that person. The components gain `TokenList`, `TokenForm` and `NewToken`; the default console gains the page at `/tokens`, with `TokenList` among the components a team may replace, and `useConsoleData` carries `tokens` with the actions to make and remove one.
