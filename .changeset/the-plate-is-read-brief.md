---
"@skillcdn/console": patch
---

My work reads the plate brief, `GET /api/v1/work?brief=true`: the tasks and the decisions without their bodies, which the page does not show and which weighed more than the rest of the plate together, as another person's plate does with `GET /api/v1/people/<id>/work?brief=true`; the command reads the plate whole as before. The client has `plate` and `personPlate`, the schemas `restWorkBriefSchema`, `restPersonWorkBriefSchema`, `restTaskBriefSchema` and `restDecisionBriefSchema`, and the composition's actions `plate` and `personPlate`; `WorkList`, `TaskList`, `Calendar` and `Week` take tasks with at least what a row says (`RestTaskBrief`), and give them to their callbacks as they came. The page the console opens on, My work or My decisions, asks for its own data along with who is signed in, rather than once the person and the workspace are known: a round trip fewer before it stands.
