---
"@skillcdn/console": patch
---

What the review before 0.4.5 found of grants and teams: purging a plugin takes away the roles it held in other plugins too (ADR-0072), each said as `plugin.revoked` on that plugin's board, so that a package installed later under the key holds nothing it was not granted; removing a team says each role granted to it as `plugin.revoked`, where it went without a word; a team's name is one line, a control or an invisible character refused (`request.invalid`, and `team.invalid_name` from the console's own check) as every other name is; two administrators changing the teams at once no longer deadlock, every write taking the workspace's row first. A frame's `open` never opens a page of the console's own origin, which is `navigate`'s (ADR-0067), and the grant's refusal names the five whom a role may go to.
