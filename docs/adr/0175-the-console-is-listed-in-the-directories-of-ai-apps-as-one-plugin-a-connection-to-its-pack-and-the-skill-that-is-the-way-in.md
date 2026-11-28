# ADR-0175: The console is listed in the directories of AI apps as one plugin, a connection to its pack and the skill that is the way in

- Status: Accepted
- Date: 2026-11-28

## Context

A person meets the console's pack by an address, `https://skillcdn.ai/gh/skillcdn/console`, which they paste into their AI app as its page shows ([ADR-0015](0015-the-consoles-skills-live-in-this-repository-in-the-skillcdn-format-and-the-package-carries-them.md)). The apps keep directories now, where a person finds a thing by its name and adds it with one press, and what a directory lists is a plugin: a connection, the skills that say how it is used, and the words and pictures of a listing. Claude's takes a connection by its address and a plugin by a repository and a path; ChatGPT's, shared with Codex, takes a ZIP in the portable format, with the listing's words, its starter prompts and the cases a review runs in the manifest.

The pack has what a directory wants, and not in its shape. Its eight skills are in the SkillCDN Format: read through the address, each comes with the manifest's rules before it and links the documents by a path from the root. Copied into a plugin they would lose both, and stand still at the day a directory reviewed them while the console moves on.

A directory's listing is also read by people who have never heard of the console. The words of the pack were written for an agent choosing a server.

## Decision

1. **One plugin, in `listing/plugin`, in both formats.** A portable manifest, `plugin.json`, with what ChatGPT and Codex read under `extensions.com.openai`, and Claude's, `.claude-plugin/plugin.json`: the same name, `skillcdn-console`, the same version and the same words. The connection is written twice for the same reason, `mcp.json` and `.mcp.json`.
2. **It carries a connection and one skill.** The connection is the pack's public address. The skill, `get-started`, sends an AI to the pack's first page, `docs/start.md`, and to the skill that page names. The console's skills are not copied in: they are read through the connection as they stand, with the manifest's rules.
3. **The listing says what the plugin is before what the console does.** A guide: it reads, asks for no sign-in, reaches no board and runs nothing on a person's computer, and the steps that take commands are carried out by a coding agent there. `docs/start.md` says the same to the AI that reads it, for an app that runs no commands.
4. **The words are skillcdn.ai's.** An AI employee, hired onto a team, takes the work, reports and asks only what is a person's to decide; the work is put on a board. The name a listing stands under is the listing's own, written once in each manifest; the product is SkillCDN Console, said in the first sentence of every description.
5. **A test holds the plugin to what the directories take** (`scripts/listing.test.mjs`, in `pnpm check`): the two manifests alike, the words within the limits, a review's five cases and three, the tools they name, the files the manifests name. A directory's portal has the last word, and what it refuses is added to the test.
6. **The plugin is no part of the pack, the package or the image.** The manifest excludes `listing`, so that its skill is not served among the console's.
7. **What is the organization's stays out**: who submits, under which account, the recording a review asks for, the token that proves the address's host. What the address answers is the main repository's.

## Consequences

- **A listing follows the pack without a new review**: what the skills say is read through the connection. A change to the listing's words, or to its one skill, is a new version of the plugin, which ChatGPT reviews as a new ZIP and Claude reads from the repository.
- **A plugin's pictures are copies** of three files of `@skillcdn/brand`, the first pictures this repository tracks; `pnpm check:text` reads no picture.
- **Words for people in another language** stand in the manifest beside the English, as a skill's translations do ([ADR-0012](0012-the-pages-speak-the-persons-language-from-packs-that-ship-with-the-package.md) for the pages).
- **A directory may refuse a plugin that is a folder of a larger repository.** Then the folder moves to a repository of its own as it is, and this one keeps the test's place by a link.
- **Rejected:**
  - the eight skills copied into the plugin: they would lose the manifest's rules and their links, and be a release behind at every review;
  - the repository's root as the plugin: a connection file at the root would be every contributor's own, and the skills there are the pack's, in another format;
  - two folders, one a directory: the same words twice, with nothing to hold them alike.
