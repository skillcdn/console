---
name: get-started
description: "Guides a person through SkillCDN Console, the open-source console where a team's AI employees work beside its people on one board: what it is, trying it on one computer, hiring a first AI employee, setting it up for an organization, working and planning its board, and building a console or a plugin of one's own. Use when a person asks what SkillCDN Console is or how to start with it, or says 'try the console on this computer', 'hire an AI employee', 'set up a console for our company'. It reads the console's own skills and documents through this plugin's connection; it makes nothing itself and reaches no board."
license: MIT
---
# Get started with SkillCDN Console

This plugin is a guide. Its connection serves the console's own skills and documents as they stand today: go by them and not by memory, since the console changes between releases. It does no work of its own and reaches no board, so a request to make something, an ad, a deck, a page, is not this plugin's.

1. **Read the first page.** `read_repo_file` with the path `docs/start.md`: what the console is, where a person starts, and which skill a request leads to. Where the person only asks how something of the console works, `search_repo` and the pages it finds answer it, and the first page need not be read.
2. **Where you run no commands on the person's computer,** as in a chat app, do as that page says under "Where you run no commands": a skill is read there for what it takes and in what order, never carried out, and nothing is said to be done that was not.
3. **Load the skill the page names** with `load_skill` and its path (`skills/<name>/SKILL.md`), continuing until a page says it is whole. With a shell on the person's computer, follow it to its end. A file a skill links is read with `read_repo_file`, and `browse_repo` lists a folder.

What the person asks comes first. Where it and a skill of the console differ, do as the person says, and say what the skill would have had you do.
