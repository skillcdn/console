---
"@skillcdn/console": patch
---

`console agent setup` keeps a runner running on Linux too (ADR-0085): the `systemd-user` service, a unit of the agent's own OS account, `~/.config/systemd/user/skillcdn-console-runner.service`, turned on and started by that account's own systemd with no administrator's rights. It runs while the account has a session, or always where an administrator turned lingering on for it; its lines are in the account's journal. Written from the system's documentation: the unit passes the system's own analyzer, and was not started on a machine yet. For whoever builds on the runner: `systemdUser`, `systemdUnit` and `SYSTEMD_UNIT` in `@skillcdn/console/runner`.
