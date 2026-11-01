---
"@skillcdn/console": patch
---

The last step of the plugins' milestone (ADR-0049, `docs/specs/plugins.md`): the skill `building-a-plugin`, the map for an agent writing a plugin, from the questions to ask and the split of a feature into commands, queries, decisions, tasks and jobs, through records or SQL, a local console with the plugin linked into `PLUGINS_DIR`, the tests and `console-plugin check`, to publishing or tagging and handing the install to the deployment as a task; "Plugins in the image" in `deploy/README.md`, how a deployment installs plugins from a lockfile with no install scripts, what `storage:sql` asks of the database user and what the two bounds mean for the container; the skills that meet plugins brought up to date (`working-the-board`, `planning-the-board`, `building-a-console`, `deploying-a-console`); and the plugin host may read a plugin's own directory where it is linked into `PLUGINS_DIR` from elsewhere, as it is while a plugin is written.
