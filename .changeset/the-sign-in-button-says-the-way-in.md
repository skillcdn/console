---
"@skillcdn/console": patch
---

The sign-in page says the way in. Each button reads "Sign in with GitHub" (or Google), carries the provider's mark before its words, is wide and a step taller than a control, keeps the focus ring at its own radius, and from the click until the browser leaves says "Going to GitHub…" with a ring turning in its text color, the other buttons set aside; a page the browser brings back from its cache is itself again. Under each button, a line says who gets in through it, from the new `admits` of every provider `GET /api/v1/me` answers: the organization at the git host whose members are in, the Workspace domains whose accounts are, or the people an administrator added. `SignIn` reads `admits` as optional, so a console built on this package shows an older console's page without the line. The word `signIn.continueWith` of the packs is `signIn.signInWith` now, with `signIn.going` and `signIn.admits` beside it.
