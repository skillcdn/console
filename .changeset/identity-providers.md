---
"@skillcdn/console": minor
---

Sign-in is per identity provider: `PROVIDER_KEYS` names them (`gh`, `google`), `GET /api/v1/me` answers `signIn` as the list of providers the deployment offers (`restProviderSchema`; empty where nobody can sign in) instead of `"gh"` or `null`, `AUTH_ROUTES.login` and `AUTH_ROUTES.callback` take the provider, `loginPath(provider, returnTo)` with them, and `SignIn` takes `providers` and shows one button for each.
