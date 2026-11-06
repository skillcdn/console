---
"@skillcdn/console": patch
---

Breaking: the console takes commands from 0.4.4 on (ADR-0038, ADR-0043). The event `person.manager_changed`, which the reporting line of the directory writes, is a kind an older command's reader refuses, so a console from 0.4.4 answers a command before 0.4.4 with `426` and `client.outdated`, naming the version to install (`npm install -g @skillcdn/console@latest`); the command's own floor stays at 0.4.2, since it needs nothing new of the console. The REST snapshot is taken again at the floors.
