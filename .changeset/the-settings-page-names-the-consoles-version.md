---
"@skillcdn/console": patch
---

The Settings page says which version the console is. The first row of the workspace's settings names it, with the range of command versions it takes, as `GET /api/v1/me` answers them in `console` (ADR-0025), so that whoever keeps the agents' commands up to date reads there what they must match; `WorkspaceSettingsView` takes them as `console`, and says nothing when the console is one from before the answer. Both packs carry the words.
