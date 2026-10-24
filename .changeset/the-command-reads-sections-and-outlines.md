---
"@skillcdn/console": patch
---

The command reads what SkillCDN 0.4 names: `console skills <file>` prints a document's outline, every heading with its level and the offset and limit that read its section, its pages joined (`--json` joins them too); `console skill --file <path> --offset <n> --limit <n>` reads one page of the file as asked, the section a search or an outline named, and says where the file continues rather than asking for the rest (`--offset` 0 or more, `--limit` 1 to 100,000, both with `--file` only); `console skills --search` prints the sections of a document that matched, and how the page was ranked where the deployment searches by meaning. `console help skills` and `console help skill` say so, and the skill working-the-board (1.22) names the two reads.
