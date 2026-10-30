# An example of a task

What a person, or their agent for them, writes on the board for an agent to take: the title says what is to be done and stands on its own; the flags carry the plan; the body is the work order, written from a scratch file of the run. An invented organization, Acme, and its web app, whose member `kim` is named by login. This is the full shape, for a person who gave the whole work order; a task given as a title alone keeps the same headings and says under "Ask" what was not said.

~~~sh
console task new "Refuse an empty file in the import parser" \
  --file task.md --category engineering --goal <the goal's id> --due +3 --worker kim
~~~

`task.md`:

~~~markdown
## What to make

The parser at `src/import/parse.ts` accepts an empty file and writes an empty record. It should refuse one with the error `import.empty`, and the API should answer `400` with it.

## Where

The repository acme/web, a branch from `main`. Its AGENTS.md holds inside it: `pnpm check` before a hand-in, a pull request and never a push to main.

## Milestones

1. A failing test that imports an empty file.
2. The fix, with the error in the API's catalogue.
3. The pull request, handed in.

## Ask

Whether an empty file is refused or skipped is settled: refused. Ask if the fix needs a change to the schema, or touches another endpoint.

## Read first

`guides/local-setup` of this project's pages; the skill `engineering/skills/working-in-web/SKILL.md` of the pack.
~~~

The command prints the task's number and its id, which are told back to the person. The agent that takes the task reads the body with `console take`, works it as working-the-board says, and hands in the pull request. What was decided before (refused, not skipped) is in the body, so that no decision is asked for it; what is left open is named, so that the agent asks on the board rather than guessing.
