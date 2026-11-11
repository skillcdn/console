---
"@skillcdn/console": patch
---

A workspace names GitLab as the git host of its agents (ADR-0089): the `gitlab` provider kind, for the role `git`, with `group` (`acme/platform`), `host` for one an organization runs itself, `account`, and `form`, the form of account an agent has there. `user`, where it names none, is a person's account, made by a person and signed in with as at GitHub, with the agent's desk in its own namespace. `service` is the host's own account for a machine, which signs in at no page: the guide and the onboarding task have whoever keeps the group make it and seed its token in the agent's store (`console agent secret <handle> git.token`), and the desk is a project of the group, `<group>/<agent>-desk`. The Settings page's services form asks the three, in English and in Korean.
