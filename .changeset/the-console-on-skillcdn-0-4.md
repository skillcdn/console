---
"@skillcdn/console": minor
---

Breaking: the console is built on SkillCDN 0.4 (ADR-0034): every `@skillcdn` package is taken at 0.4.0, and the version moves to the 0.4 line. The command and the console go together within a line (ADR-0038), so the floors are 0.4.0 on both sides: a 0.4 console refuses a 0.3 command with `426` and `client.outdated`, naming the version to install (`npm install -g @skillcdn/console@0.4.0`), and a 0.4 command refuses a 0.3 console as `console.outdated`; a deployment of this release has every agent's command updated once. Nothing the console reads or sends changed shape otherwise.

What SkillCDN 0.4 brings to a pack read through the console flows through as every answer of a pack does: a search names the sections of a document that matched, each with the offset and limit that read it (`sections` on `RestFind`); a file's path browses to the file's outline (`outline` on `RestBrowse`, with `entries` empty); and a result says how it was ranked where the deployment searches by meaning as well as by words (`ranking`). The connection instructions `console skills` prints say the same, as the deployment says them.
