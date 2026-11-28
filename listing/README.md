# listing/

What the console is listed with in the directories of AI apps ([ADR-0175](../docs/adr/0175-the-console-is-listed-in-the-directories-of-ai-apps-as-one-plugin-a-connection-to-its-pack-and-the-skill-that-is-the-way-in.md)): one plugin, [`plugin/`](plugin/), in the two formats those directories take, and the words it is listed under. Nothing here is part of the pack, the package or the image.

The plugin is a guide, and says so: a connection to the pack's public address, `https://skillcdn.ai/gh/skillcdn/console`, and one skill that sends an AI to the pack's first page. It reads, asks for no sign-in, and reaches no board and no computer.

## The plugin's files

| File | What it is |
|---|---|
| `plugin.json` | The portable manifest (Agent Plugins): the plugin's name and version, and under `extensions.com.openai` the listing's words, its starter prompts, the cases a review runs and the words in other languages. What ChatGPT and Codex read. |
| `mcp.json` | The connection, in that format's words (`streamable-http`). |
| `.claude-plugin/plugin.json` | Claude's manifest: the same name, version and words, with the links its directory shows. |
| `.mcp.json` | The same connection, in Claude's words (`http`). |
| `skills/get-started/SKILL.md` | The one skill: read `docs/start.md` through the connection, then follow the skill it names. The console's own skills are not copied here. |
| `assets/` | The SkillCDN symbol from `@skillcdn/brand`, as that package gives it: `logo.png` (`avatar.png`), `logo-dark.png` (`icon-512.png`), `icon.png` (`symbol.png`). Copied again when the brand changes, never redrawn. |
| `README.md` | The plugin's own page, which a directory shows: what to ask, what it is made of, what it does and does not do. |

## The words

| Word | Where it is written | A directory's limit |
|---|---|---|
| The name, `SkillCDN AI Team` | `displayName` in both manifests | 30 characters |
| The subtitle, `Hire AI employees on one board` | `shortDescription` | 30 characters |
| The description | `longDescription`; typed as it is into the form of a connection at Claude | 2,000 characters, the smaller of the two |
| The starter prompts | `defaultPrompt` | three, 128 characters each |
| The one line of a connection at Claude | here: `Set up and run a team of AI employees on your own board, step by step` | 200 characters |
| The use cases of a connection at Claude | the five questions of [`plugin/README.md`](plugin/README.md) | three at the least |
| The category | `category`: Productivity | one of the directory's own |

The name is the listing's. The product is SkillCDN Console, and every description says so in its first sentence.

They are written as skillcdn.ai writes: an AI employee is hired, takes the work, reports and asks only what is a person's to decide; the work is put on a board, and a person just decides. They say what the plugin is, a guide that only reads, before anything else it could be taken for. They name no price, compare with nothing, and claim nothing that a person who installs it cannot see.

## Where it goes

- **Claude.** Two submissions at its directory's portal: the connection, by its address, with the words above typed into the form; then the plugin, by this repository and the path `listing/plugin`. The directory reads the plugin's listing from `.claude-plugin/plugin.json` and its `README.md`.
- **ChatGPT and Codex.** One ZIP of the portable files, uploaded at the portal, which reads everything from `plugin.json`:

  ```sh
  git archive --format=zip --output=skillcdn-console-plugin.zip HEAD:listing/plugin plugin.json mcp.json skills assets
  ```

  The recording a review asks for is named at the portal, or as `review.demo_recording_url` once there is one.

## Checks

- `node --test scripts/listing.test.mjs`, part of `pnpm check`: the two manifests say the same, the words are within the limits above, a review has its five cases and its three, each naming tools the address has, and every file named is there.
- `claude plugin validate listing/plugin`, where Claude Code is installed: its own reading of the manifest and the files.
- A directory's portal validates what it is given, and has the last word. What it refuses that this page does not know is added here and to the test.

## When it changes

- **The words or the skill:** in both manifests, with a version raised in both. ChatGPT takes a new ZIP and reviews it; Claude follows the repository.
- **The pack's address, a tool's name, the first page's path:** both connections, the skill and the review's cases name them.
- **What the console's skills say** changes nothing here: they are read through the connection as they stand.

## What is not here

Who submits and under which account, what a directory asks of that account, the recording, and the token a directory gives to prove the address's host are the organization's own and stay out of this repository. What the address itself answers, its tools, their annotations and the proof of its host, is the main repository's.
