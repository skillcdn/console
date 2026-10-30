---
"@skillcdn/console": patch
---

The command says why a token is refused when its person is out. A console from 0.4.1 answers `auth.deactivated`, for a person deactivated, or `auth.not_admitted`, for one whose domain or organization is no longer named, in place of `auth.required` for a token it knows, on every route and at `GET /api/v1/me`; the token is kept and works again when the person is back in. The command prints the two with what to do, `console logout` says that the console keeps such a token and forgets it on the machine, and `console help` lists them among the refusals any command may meet.
