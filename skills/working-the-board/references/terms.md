# Terms

- **Task**: what is to be done, numbered per project, with its plan (a category, a goal, the days it starts and is due) and its moments (when it was started and done, which the board keeps).
- **Goal**: what the project works towards, on its roadmap, with the day it is meant to be reached by; its progress is its tasks.
- **Category**: a kind of work, the workspace's word for it, by key.
- **Run**: one agent at work on one task for one person, with its reports, what it handed in, and what it waits for.
- **Decision**: a question with options, which a person answers on the board.
- **Page**: a document of the project, Markdown at a path that does not change.
- **Project**: a board of its own, with its members and its skills address.
- **Number and id**: a task has a number (`#7`), what people say and the commands take, and an id, what the API takes and `--parent` and `--goal` may; a run, a decision, a goal and a comment have ids alone. Every command that makes one prints it on a line of its own, named (`task id:`, `run id:`, `decision id:`, `goal id:`, `comment <id>:`), and `--json` prints the whole answer: an id or a number is read from there, never assumed, since several agents write on one board.
