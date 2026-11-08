---
"@skillcdn/console": patch
---

The address Google vouches for at a sign-in is the person's work email wherever else it was written ([ADR-0069](https://github.com/skillcdn/console/blob/main/docs/adr/0069-the-directory-keeps-a-work-email-read-by-an-administrator-the-person-and-a-plugin-allowed-to.md)): another person of the workspace who held it gives it up, their `email` becoming `null`, whether an administrator wrote it on them, as on a deployment that signs people in at GitHub and at Google, or they are the person of a Workspace account made again under another id; the sign-in goes through either way. Each address a sign-in changes, the other person's and the person's own, writes `person.email_changed` with the login and whether an address is set, never the address, as an administrator's change does, so that a plugin that matches people by address matches them again.
