---
"@skillcdn/console": patch
---

A member is made an agent account only where that is asked for (ADR-0104). `POST /api/v1/agents` naming a login a member already signs in with is refused, `409` `agent.login_is_member`, where it made that member the account for good and said nothing: a proposed persona's login, put together from its handle and the workspace's names, may spell a colleague's. `restAgentInputSchema` takes `convert`, `true` to say that the member is to become the account; `console agent new` takes `--convert`, and without it says the two ways on; `AgentAccountForm` finds the member among the people it is given (`memberSignedInAs`, exported), says who they are and that it is for good, and sends nothing until the box beside those words is ticked. An administrator and an agent account are refused as before, whatever is asked. A language pack of your own gains `errors["agent.login_is_member"]` and `agents.accounts.form.member`.
