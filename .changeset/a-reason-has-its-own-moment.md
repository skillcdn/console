---
"@skillcdn/console": patch
---

Why an agent account stands as it does is no longer shown beside a moment that is its state's. The card and the page showed the last reason next to since when the state stood, so an account that began a new conversation today read as "it began a new conversation · since 23 Nov", the day it started running.

- **The console keeps when the reason was said**, apart from since when the state stands, and answers it as `state.reasonAt` of an agent: the same moment as `since` where the two came together, a later one where the reason changed under a state that stayed, `null` where it keeps none (a reason of before this version), and left out by a console of before.
- **The card** says the reason with its own moment in brackets, and under it the state with since when it stands: "it began a new conversation (23:12)" over "running since 23 Nov, 17:41". **The page** says since when right after the state's badge, then the reason with its moment. A reason that came with its state, or that has no moment kept, is shown with none.
- **`console agent <handle>`** prints `state: running since <moment>; why: reset, said <moment>; its runner was last heard from <moment>`, where it printed `state: running (reset) since <moment>; ...`: the moment after `since` is the state's alone.
- **The runner says when it said the reason** with each heartbeat (`reasonAt`), since a reason is said anew under a state that stays and every heartbeat repeats it. A runner of before says none, and the console then dates a reason when it is first another than the one kept; a console of before reads past the field.
- For a console of one's own: `RestAgentState` has `reasonAt`, optional; the words `agents.page.state.sinceAs` and `agents.page.state.reasonAt` are new in both language packs.
