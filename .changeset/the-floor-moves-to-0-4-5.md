---
"@skillcdn/console": patch
---

Breaking: the console takes commands from 0.4.5 on (ADR-0038, ADR-0043). The event `person.email_changed`, which the work email of the directory writes, is a kind an older command's reader refuses, so a console from 0.4.5 answers a command before 0.4.5 with `426` and `client.outdated`, naming the version to install (`npm install -g @skillcdn/console@latest`); the command's own floor stays at 0.4.2, since it reads an older console as before. The REST snapshot is taken again at the floors. The teams' events (`team.created`, `team.renamed`, `team.removed`, `team.member_added`, `team.member_removed`, ADR-0073) are among the kinds an older command's reader refuses.
